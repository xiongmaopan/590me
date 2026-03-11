// 590.me YouTube Parser API - Cloudflare Worker
// Mobile YouTube page (all formats with signatureCipher) + ES6 player.js for decipher

// ---- G Array and Decipher Extraction ----

function parseGArray(playerJs) {
  const match = playerJs.match(/var\s+G\s*=\s*"([^"]+)"\.split\("([^"]*)"\)/);
  if (!match) return null;
  return match[1].split(match[2]);
}

function findHelperObject(playerJs, G) {
  const reverseIdx = G.indexOf('reverse');
  const spliceIdx = G.indexOf('splice');
  if (reverseIdx === -1 || spliceIdx === -1) return null;

  const revPattern = new RegExp(`(\\w+):function\\(l\\)\\{l\\[G\\[${reverseIdx}\\]\\]\\(\\)\\}`);
  const revMatch = playerJs.match(revPattern);
  if (!revMatch) return null;

  const pos = playerJs.indexOf(revMatch[0]);
  const before = playerJs.substring(Math.max(0, pos - 200), pos);
  const varMatch = before.match(/var\s+(\w+)\s*=\s*\{[^{]*$/);
  if (!varMatch) return null;

  const objName = varMatch[1];
  const objEnd = playerJs.indexOf('};', pos);
  if (objEnd < 0) return null;
  const objCode = playerJs.substring(pos - 1, objEnd + 2);

  const methods = {};
  methods[revMatch[1]] = 'reverse';

  const splMatch = objCode.match(new RegExp(`(\\w+):function\\(l,y\\)\\{l\\[G\\[${spliceIdx}\\]\\]\\(0,y\\)\\}`));
  if (splMatch) methods[splMatch[1]] = 'splice';

  const swapMatch = objCode.match(/(\w+):function\(l,y\)\{var\s+\w=l\[0\];l\[0\]=l\[y%l\[G\[\d+\]\]\];l\[y%l\[G\[\d+\]\]\]=\w\}/);
  if (swapMatch) methods[swapMatch[1]] = 'swap';

  if (Object.keys(methods).length < 3) return null;
  return { name: objName, methods };
}

function extractDecipherOps(playerJs) {
  const G = parseGArray(playerJs);
  if (!G) return null;

  const helper = findHelperObject(playerJs, G);
  if (!helper) return null;

  const splitIdx = G.indexOf('split');
  const joinIdx = G.indexOf('join');
  const emptyIdx = G.indexOf('');
  if (splitIdx === -1 || joinIdx === -1 || emptyIdx === -1) return null;

  const helperName = helper.name.replace(/\$/g, '\\$');

  // Find the first reference to HELPER[G[t^
  const refIdx = playerJs.indexOf(`${helper.name}[G[t^`);
  if (refIdx < 0) return null;

  // Get surrounding context (before and after)
  const context = playerJs.substring(Math.max(0, refIdx - 150), refIdx + 500);

  // Find the split call: X=Y[G[t^NUM]](G[emptyIdx])
  const splitCallRegex = new RegExp(`(\\w)=(\\w)\\[G\\[t\\^(\\d+)\\]\\]\\(G\\[${emptyIdx}\\]\\)`);
  const splitCallMatch = context.match(splitCallRegex);
  if (!splitCallMatch) return null;

  const splitXorVal = parseInt(splitCallMatch[3]);
  const t = splitXorVal ^ splitIdx;

  // Extract operations
  const opRegex = new RegExp(
    `${helperName}\\[G\\[t\\^(\\d+)\\]\\]\\(\\w,(t\\^(\\d+)|(\\d+))\\)`, 'g'
  );

  const ops = [];
  let m;
  while ((m = opRegex.exec(context)) !== null) {
    const methodGIdx = t ^ parseInt(m[1]);
    const methodName = G[methodGIdx];
    if (!methodName) continue;
    const opType = helper.methods[methodName];
    if (!opType) continue;

    let arg;
    if (m[3] !== undefined) {
      arg = t ^ parseInt(m[3]);
    } else {
      arg = parseInt(m[4]);
    }
    ops.push({ type: opType, arg });
  }

  return ops.length > 0 ? ops : null;
}

function applyDecipherOps(signature, ops) {
  let a = signature.split('');
  for (const op of ops) {
    switch (op.type) {
      case 'reverse':
        a.reverse();
        break;
      case 'splice':
        a.splice(0, op.arg);
        break;
      case 'swap': {
        const temp = a[0];
        a[0] = a[op.arg % a.length];
        a[op.arg % a.length] = temp;
        break;
      }
    }
  }
  return a.join('');
}

function decipherSignatureCipher(cipher, ops) {
  const params = new URLSearchParams(cipher);
  const s = params.get('s');
  const sp = params.get('sp') || 'signature';
  const url = params.get('url');
  if (!s || !url) return null;
  const sig = applyDecipherOps(decodeURIComponent(s), ops);
  return `${decodeURIComponent(url)}&${sp}=${encodeURIComponent(sig)}`;
}

// ---- Main Logic ----

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function getES6PlayerUrl(anyPlayerUrl) {
  // Extract the player hash and construct the ES6 URL
  // Mobile: /s/player/HASH/player-plasma-ias-phone-en_US.vflset/base.js
  // Desktop: /s/player/HASH/player_es6.vflset/en_US/base.js
  const hashMatch = anyPlayerUrl.match(/\/s\/player\/([a-f0-9]+)\//);
  if (!hashMatch) return null;
  return `/s/player/${hashMatch[1]}/player_es6.vflset/en_US/base.js`;
}

async function parseYouTube(videoId) {
  // Step 1: Fetch MOBILE page (all formats with signatureCipher)
  const resp = await fetch(`https://m.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=PENDING+999; SOCS=CAESEwgDEgk2NTI4MTg2MzkaAmVuIAEaBgiA_9S6Bg'
    }
  });
  const html = await resp.text();

  // Step 2: Extract player response
  const prMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!prMatch) throw new Error('Player response not found');
  const pr = JSON.parse(prMatch[1]);

  if (pr.playabilityStatus?.status !== 'OK') {
    throw new Error(pr.playabilityStatus?.reason || 'Video unavailable');
  }

  // Step 3: Get player URL and convert to ES6 version
  const playerUrlMatch = html.match(/"jsUrl"\s*:\s*"([^"]+)"/);
  if (!playerUrlMatch) throw new Error('Player JS URL not found');

  const es6Url = getES6PlayerUrl(playerUrlMatch[1]);
  if (!es6Url) throw new Error('Could not determine player URL');

  const playerResp = await fetch(`https://www.youtube.com${es6Url}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!playerResp.ok) throw new Error(`Failed to fetch player.js: ${playerResp.status}`);
  const playerJs = await playerResp.text();

  // Step 4: Extract decipher operations
  const ops = extractDecipherOps(playerJs);
  if (!ops || ops.length === 0) throw new Error('Could not extract decipher operations');

  // Step 5: Build formats
  const sd = pr.streamingData || {};
  const formats = [];
  const seen = new Set();

  for (const f of (sd.formats || [])) {
    let url = f.url;
    if (!url && f.signatureCipher) {
      url = decipherSignatureCipher(f.signatureCipher, ops);
    }
    if (!url) continue;
    const key = `v_${f.itag}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mime = f.mimeType || '';
    const container = mime.split('/')[1]?.split(';')[0] || 'mp4';
    formats.push({
      format_id: String(f.itag),
      quality: f.qualityLabel || '360p',
      resolution: f.qualityLabel || `${f.width}x${f.height}`,
      ext: container,
      url,
      size: f.contentLength ? parseInt(f.contentLength) : null,
      fps: f.fps || null,
      type: 'video'
    });
  }

  for (const f of (sd.adaptiveFormats || [])) {
    let url = f.url;
    if (!url && f.signatureCipher) {
      url = decipherSignatureCipher(f.signatureCipher, ops);
    }
    if (!url) continue;
    const key = `${f.itag}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mime = f.mimeType || '';
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    const container = mime.split('/')[1]?.split(';')[0] || 'mp4';

    let type, quality;
    if (isVideo) {
      type = 'video_only';
      quality = `${f.qualityLabel || '?'} (video only)`;
    } else if (isAudio) {
      type = 'audio';
      const br = f.averageBitrate ? Math.round(f.averageBitrate / 1000) : '?';
      quality = `${br}kbps`;
    } else continue;

    formats.push({
      format_id: String(f.itag),
      quality,
      resolution: isVideo ? (f.qualityLabel || `${f.width}x${f.height}`) : 'Audio',
      ext: container,
      url,
      size: f.contentLength ? parseInt(f.contentLength) : null,
      fps: f.fps || null,
      type
    });
  }

  const order = { video: 0, video_only: 1, audio: 2 };
  formats.sort((a, b) => {
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
    return (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0);
  });

  const vd = pr.videoDetails || {};
  const thumbs = vd.thumbnail?.thumbnails || [];

  return {
    success: true,
    title: vd.title || 'Unknown',
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
    duration: parseInt(vd.lengthSeconds) || 0,
    uploader: vd.author || '',
    formats
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname !== '/api/parse') {
      return Response.json({ success: false, error: 'POST /api/parse with {"url":"..."}' }, { status: 404, headers: cors });
    }

    try {
      let videoUrl;
      if (request.method === 'POST') {
        const body = await request.json();
        videoUrl = body.url;
      } else if (request.method === 'GET') {
        videoUrl = reqUrl.searchParams.get('url');
      } else {
        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: cors });
      }

      if (!videoUrl) return Response.json({ success: false, error: 'URL is required' }, { status: 400, headers: cors });

      const videoId = extractVideoId(videoUrl);
      if (!videoId) return Response.json({ success: false, error: 'Invalid YouTube URL' }, { status: 400, headers: cors });

      const result = await parseYouTube(videoId);
      return Response.json(result, { headers: cors });

    } catch (error) {
      return Response.json({
        success: false,
        error: error.message || 'Parse failed'
      }, { status: 500, headers: cors });
    }
  }
};
