const ytdl = require('@distube/ytdl-core');

// Rate limiting
const rateLimit = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const requests = rateLimit.get(ip) || [];
    const recent = requests.filter(t => t > now - 60000);
    if (recent.length >= 10) return false;
    recent.push(now);
    rateLimit.set(ip, recent);
    return true;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const clientIp = req.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ success: false, error: 'Too many requests.' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    if (!ytdl.validateURL(url)) {
        return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });
    }

    try {
        const agent = ytdl.createAgent();
        const info = await ytdl.getInfo(url, {
            agent,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            }
        });

        const formats = [];
        const seen = new Set();

        // Process all formats from raw data
        for (const f of info.formats) {
            if (!f.url) continue;

            const hasVideo = f.hasVideo;
            const hasAudio = f.hasAudio;
            let type, quality, key;

            if (hasVideo && hasAudio) {
                type = 'video';
                quality = f.qualityLabel || f.quality || 'unknown';
                key = `v_${quality}_${f.container}`;
            } else if (hasVideo && !hasAudio) {
                type = 'video_only';
                quality = `${f.qualityLabel || f.quality || '?'} (video only)`;
                key = `vo_${f.qualityLabel}_${f.container}`;
            } else if (hasAudio && !hasVideo) {
                type = 'audio';
                quality = `${f.audioBitrate || '?'}kbps`;
                key = `a_${quality}_${f.container}`;
            } else {
                continue;
            }

            if (seen.has(key)) continue;
            seen.add(key);

            formats.push({
                format_id: String(f.itag),
                quality,
                resolution: hasVideo ? (f.qualityLabel || `${f.width}x${f.height}`) : 'Audio',
                ext: f.container || 'mp4',
                url: f.url,
                size: f.contentLength ? parseInt(f.contentLength) : null,
                fps: f.fps || null,
                type
            });
        }

        // Sort: video first (by height desc), then video_only (by height desc), then audio (by bitrate desc)
        const order = { video: 0, video_only: 1, audio: 2 };
        formats.sort((a, b) => {
            if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
            const aVal = parseInt(a.resolution) || parseInt(a.quality) || 0;
            const bVal = parseInt(b.resolution) || parseInt(b.quality) || 0;
            return bVal - aVal;
        });

        const thumbnails = info.videoDetails.thumbnails || [];

        return res.json({
            success: true,
            title: info.videoDetails.title || 'Unknown',
            thumbnail: thumbnails.length ? thumbnails[thumbnails.length - 1].url : '',
            duration: parseInt(info.videoDetails.lengthSeconds) || 0,
            uploader: info.videoDetails.author?.name || '',
            formats
        });

    } catch (error) {
        console.error('Parse error:', error.message);

        let msg = 'Failed to parse video.';
        if (error.message.includes('private') || error.message.includes('unavailable')) {
            msg = 'Video is private or unavailable.';
        } else if (error.message.includes('age')) {
            msg = 'Age-restricted video.';
        } else if (error.message.includes('No such format found') || error.message.includes('No playable')) {
            msg = 'No downloadable formats found. YouTube may be blocking this request.';
        }

        return res.status(500).json({ success: false, error: msg, debug: error.message });
    }
};
