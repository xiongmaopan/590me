# 590.me 在线视频解析下载技术方案分析

## 一、核心原理

在线视频下载器的核心流程：

```
用户输入URL → 后端解析页面 → 提取视频源地址 → 返回下载链接 → 用户下载
```

## 二、技术架构方案

### 方案A：纯前端方案（受限，不推荐）

**原理：** 使用CORS代理 + 页面抓取

```javascript
// 前端直接请求（受CORS限制）
async function parseVideo(url) {
    // 需要CORS代理
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/' + url;
    const response = await fetch(proxyUrl);
    const html = await response.text();
    // 解析HTML提取视频地址
    const videoUrl = extractVideoUrl(html);
    return videoUrl;
}
```

**缺点：**
- 受浏览器CORS策略限制
- YouTube等平台有反爬机制
- 无法处理加密/签名视频
- 不稳定，容易失效

---

### 方案B：后端代理方案（推荐）

**架构：**
```
Frontend (590.me)
    ↓ API请求
Backend Server (Node.js/Python)
    ↓ 无头浏览器/解析库
Video Platform (YouTube/TikTok/...)
    ↓ 返回视频源
Backend Server
    ↓ 返回解析结果
Frontend (展示下载选项)
```

**核心组件：**

#### 1. 后端服务

**Node.js + yt-dlp 方案：**

```javascript
// server.js - Express后端
const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 解析视频API
app.post('/api/parse', async (req, res) => {
    const { url } = req.body;
    
    // 使用yt-dlp解析
    const command = `yt-dlp -j --no-download "${url}"`;
    
    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            return res.status(400).json({ error: 'Parse failed' });
        }
        
        const info = JSON.parse(stdout);
        
        // 提取各画质链接
        const formats = info.formats.map(f => ({
            quality: f.format_note,
            resolution: f.resolution,
            url: f.url,  // 直接下载链接
            ext: f.ext,
            size: f.filesize
        }));
        
        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            formats: formats
        });
    });
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
```

**Python + yt-dlp 方案：**

```python
# app.py - Flask后端
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

@app.route('/api/parse', methods=['POST'])
def parse_video():
    url = request.json.get('url')
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            formats = []
            for f in info.get('formats', []):
                formats.append({
                    'quality': f.get('format_note', 'unknown'),
                    'resolution': f.get('resolution', 'unknown'),
                    'url': f.get('url'),
                    'ext': f.get('ext'),
                    'size': f.get('filesize')
                })
            
            return jsonify({
                'title': info.get('title'),
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
                'formats': formats
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(port=3000)
```

---

### 方案C：无头浏览器方案（处理复杂网站）

**适用场景：**
- 需要执行JavaScript才能获取视频地址的网站
- 有复杂反爬机制的平台
- 需要模拟用户行为的场景

```javascript
// 使用Puppeteer/Playwright
const puppeteer = require('puppeteer');

async function parseWithBrowser(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // 拦截网络请求，捕获视频地址
    const videoUrls = [];
    await page.setRequestInterception(true);
    
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.mp4') || url.includes('.m3u8')) {
            videoUrls.push(url);
        }
        request.continue();
    });
    
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // 等待视频加载
    await page.waitForTimeout(3000);
    
    await browser.close();
    
    return videoUrls;
}
```

---

## 三、各平台解析特点

### YouTube

**技术难点：**
- 视频流分片（DASH格式）
- 签名加密（cipher/sig）
- 频繁更新反爬机制

**解决方案：**
```bash
# yt-dlp自动处理YouTube签名
yt-dlp -f "best[height<=1080]" --get-url "VIDEO_URL"

# 获取所有可用格式
yt-dlp -F "VIDEO_URL"
```

**返回格式：**
```json
{
    "title": "Video Title",
    "formats": [
        {
            "format_id": "137",
            "ext": "mp4",
            "resolution": "1920x1080",
            "url": "https://googlevideo.com/...",
            "video_codec": "avc1.640028"
        }
    ]
}
```

---

### TikTok

**技术难点：**
- 无水印视频需要特殊处理
- 视频地址有时效性
- 需要处理重定向

**解决方案：**
```python
import requests
import re

def parse_tiktok(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    # 获取页面内容
    response = requests.get(url, headers=headers, allow_redirects=True)
    
    # 提取视频信息
    video_data = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', response.text)
    
    if video_data:
        import json
        data = json.loads(video_data.group(1))
        video_info = data['__DEFAULT_SCOPE__']['webapp.video-detail']['itemInfo']['itemStruct']
        
        return {
            'title': video_info['desc'],
            'cover': video_info['video']['cover'],
            'no_watermark_url': video_info['video']['playAddr'],
            'watermark_url': video_info['video']['downloadAddr']
        }
```

---

### Instagram

**技术难点：**
- 需要登录才能查看某些内容
- GraphQL API复杂
- 反爬严格

**解决方案：**
```python
import instaloader

def parse_instagram(url):
    L = instaloader.Instaloader()
    
    # 提取shortcode
    shortcode = url.split('/p/')[1].split('/')[0]
    
    post = instaloader.Post.from_shortcode(L.context, shortcode)
    
    videos = []
    if post.is_video:
        videos.append({
            'url': post.video_url,
            'thumbnail': post.url,
            'caption': post.caption
        })
    
    return videos
```

---

### 抖音 (Douyin)

**技术难点：**
- 需要处理X-Bogus签名
- 接口加密
- 频繁更新

**解决方案：**
```python
import requests
import re

def parse_douyin(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)',
        'Referer': 'https://www.douyin.com/'
    }
    
    # 获取重定向后的URL
    response = requests.get(url, headers=headers, allow_redirects=True)
    
    # 提取视频ID
    video_id = re.search(r'/video/(\d+)', response.url)
    
    if video_id:
        # 调用API获取视频信息
        api_url = f'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id={video_id.group(1)}'
        
        data = requests.get(api_url, headers=headers).json()
        video_info = data['aweme_detail']
        
        return {
            'title': video_info['desc'],
            'cover': video_info['video']['cover']['url_list'][0],
            'no_watermark_url': video_info['video']['play_addr']['url_list'][0]
        }
```

---

## 四、部署架构

### 推荐架构

```
┌─────────────────┐
│   CloudFlare    │  ← CDN + DDoS防护
│      CDN        │
└────────┬────────┘
         │
┌────────▼────────┐
│   API Gateway   │  ← 限流、认证
│   (Nginx/AWS)   │
└────────┬────────┘
         │
┌────────▼────────┐
│  Load Balancer  │  ← 负载均衡
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼────┐
│Server1│ │Server2│  ← 解析服务集群
│(Docker)│ │(Docker)│
└───┬───┘ └──┬────┘
    │        │
    └────┬───┘
         │
┌────────▼────────┐
│   Redis Cache   │  ← 缓存解析结果
└─────────────────┘
```

### Docker部署

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 3000

CMD ["python", "app.py"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    deploy:
      replicas: 3

  redis:
    image: redis:alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api

volumes:
  redis_data:
```

---

## 五、前端集成

```javascript
// 前端调用示例
async function parseVideo(url) {
    const response = await fetch('https://api.590.me/parse', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url })
    });
    
    const data = await response.json();
    
    // 显示下载选项
    showDownloadOptions(data);
}

function showDownloadOptions(data) {
    const container = document.getElementById('download-options');
    
    data.formats.forEach(format => {
        const btn = document.createElement('a');
        btn.href = format.url;
        btn.className = 'download-option';
        btn.innerHTML = `
            <span class="quality">${format.quality}</span>
            <span class="resolution">${format.resolution}</span>
            <span class="size">${formatSize(format.size)}</span>
        `;
        btn.download = `${data.title}.${format.ext}`;
        container.appendChild(btn);
    });
}
```

---

## 六、法律与合规

### 注意事项

1. **版权声明**
   - 仅下载用户有权限的内容
   - 尊重DMCA
   - 提供举报机制

2. **服务条款**
   - 明确告知用户责任
   - 禁止下载受版权保护内容
   - 个人使用声明

3. **技术防护**
   - 限制请求频率
   - 不存储视频文件
   - 仅提供解析服务

---

## 七、推荐技术栈

| 组件 | 推荐方案 | 理由 |
|-----|---------|-----|
| 后端 | Python + yt-dlp | 成熟稳定，支持1000+网站 |
| 前端 | Vanilla JS / React | 轻量，SEO友好 |
| 部署 | Docker + AWS/GCP | 可扩展，成本低 |
| 缓存 | Redis | 减少重复解析 |
| CDN | CloudFlare | 免费，有防护 |

---

## 八、开发优先级

1. **P0 - 核心功能**
   - [ ] YouTube解析
   - [ ] TikTok解析
   - [ ] 基础下载功能

2. **P1 - 扩展平台**
   - [ ] Instagram
   - [ ] 抖音
   - [ ] Bilibili

3. **P2 - 增强功能**
   - [ ] 批量下载
   - [ ] 格式转换
   - [ ] 桌面客户端

4. **P3 - 优化**
   - [ ] 缓存系统
   - [ ] 用户历史
   - [ ] 高级设置
