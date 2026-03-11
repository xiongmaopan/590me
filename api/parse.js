// Vercel Serverless Function - 视频解析API
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const https = require('https');
const fs = require('fs');
const path = require('path');

// 确保 yt-dlp 可用
async function ensureYtDlp() {
    const ytDlpPath = path.join('/tmp', 'yt-dlp');
    
    // 检查是否已存在
    if (fs.existsSync(ytDlpPath)) {
        return ytDlpPath;
    }
    
    // 下载 yt-dlp
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(ytDlpPath);
        https.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                fs.chmodSync(ytDlpPath, '755');
                resolve(ytDlpPath);
            });
        }).on('error', (err) => {
            fs.unlink(ytDlpPath, () => {});
            reject(err);
        });
    });
}

// 简单的内存缓存
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 请求限流
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟
const RATE_LIMIT_MAX = 10; // 每分钟最多10次

function checkRateLimit(ip) {
    const now = Date.now();
    const requests = rateLimit.get(ip) || [];
    const recentRequests = requests.filter(t => t > now - RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= RATE_LIMIT_MAX) {
        return false;
    }
    
    recentRequests.push(now);
    rateLimit.set(ip, recentRequests);
    return true;
}

function getCacheKey(url) {
    return Buffer.from(url).toString('base64');
}

function getCachedResult(url) {
    const key = getCacheKey(url);
    const cached = cache.get(key);
    
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }
    
    cache.delete(key);
    return null;
}

function setCachedResult(url, data) {
    const key = getCacheKey(url);
    cache.set(key, { data, time: Date.now() });
}

// 清理过期缓存
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.time > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, 60 * 1000);

module.exports = async (req, res) => {
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理预检请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }
    
    // 获取客户端IP
    const clientIp = req.headers['x-forwarded-for'] || 
                     req.headers['x-real-ip'] || 
                     'unknown';
    
    // 限流检查
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded. Please try again later.'
        });
    }
    
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL is required' 
        });
    }
    
    // 验证URL格式
    try {
        new URL(url);
    } catch {
        return res.status(400).json({
            success: false,
            error: 'Invalid URL format'
        });
    }
    
    // 检查缓存
    const cached = getCachedResult(url);
    if (cached) {
        return res.json({
            success: true,
            cached: true,
            ...cached
        });
    }
    
    try {
        // 确保 yt-dlp 可用
        const ytDlpPath = await ensureYtDlp();
        
        // 使用 yt-dlp 解析
        const command = `${ytDlpPath} -j --no-download --no-check-certificate "${url}"`;
        
        const { stdout, stderr } = await execPromise(command, { 
            timeout: 25000, // 25秒超时
            maxBuffer: 10 * 1024 * 1024 // 10MB输出限制
        });
        
        if (!stdout) {
            throw new Error('No output from parser');
        }
        
        const info = JSON.parse(stdout);
        
        // 提取视频格式
        const formats = [];
        
        if (info.formats && Array.isArray(info.formats)) {
            for (const f of info.formats) {
                // 跳过m3u8格式（需要特殊处理）
                if (f.protocol === 'm3u8_native' || f.protocol === 'm3u8') {
                    continue;
                }
                
                // 只保留有直链的格式
                if (!f.url) continue;
                
                formats.push({
                    format_id: f.format_id,
                    quality: f.format_note || f.quality_label || f.resolution || 'unknown',
                    resolution: f.resolution || `${f.width || 0}x${f.height || 0}`,
                    ext: f.ext || 'mp4',
                    url: f.url,
                    size: f.filesize || f.filesize_approx || null,
                    fps: f.fps || null,
                    vcodec: f.vcodec || null,
                    acodec: f.acodec || null
                });
            }
        }
        
        // 按分辨率排序（高到低）
        formats.sort((a, b) => {
            const getHeight = (res) => {
                const match = res.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            };
            return getHeight(b.resolution) - getHeight(a.resolution);
        });
        
        // 去重（相同分辨率只保留一个）
        const uniqueFormats = [];
        const seenResolutions = new Set();
        
        for (const f of formats) {
            const key = `${f.resolution}_${f.ext}`;
            if (!seenResolutions.has(key) && uniqueFormats.length < 8) {
                seenResolutions.add(key);
                uniqueFormats.push(f);
            }
        }
        
        const result = {
            success: true,
            title: info.title || 'Unknown',
            description: info.description || '',
            thumbnail: info.thumbnail || '',
            duration: info.duration || 0,
            uploader: info.uploader || info.channel || info.uploader_id || '',
            upload_date: info.upload_date || '',
            webpage_url: info.webpage_url || url,
            original_url: url,
            extractor: info.extractor || 'generic',
            formats: uniqueFormats
        };
        
        // 缓存结果
        setCachedResult(url, result);
        
        res.json(result);
        
    } catch (error) {
        console.error('Parse error:', error.message);
        
        // 分析错误类型
        let errorMessage = 'Failed to parse video';
        let statusCode = 500;
        
        if (error.message.includes('Unsupported URL')) {
            errorMessage = 'Unsupported video platform. Please check the URL.';
            statusCode = 400;
        } else if (error.message.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private.';
            statusCode = 404;
        } else if (error.message.includes('Sign in')) {
            errorMessage = 'This video requires authentication.';
            statusCode = 403;
        } else if (error.code === 'ETIMEDOUT' || error.killed) {
            errorMessage = 'Request timeout. Please try again.';
            statusCode = 504;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
