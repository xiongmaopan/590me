# 590.me 后端免费部署方案大全

## 一、Serverless 函数方案（推荐）

### 1. Vercel Serverless Functions ⭐最推荐

**优点：**
- 免费额度：每月 100GB 带宽 + 1000GB-hours 执行时间
- 自带全球 CDN
- 自动 HTTPS
- 与前端同平台，部署简单

**部署步骤：**

```javascript
// api/parse.js - Vercel Serverless Function
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

module.exports = async (req, res) => {
    // 设置CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        // Vercel需要安装yt-dlp为依赖
        const { stdout } = await execPromise(
            `python3 -m yt_dlp -j --no-download "${url}"`,
            { timeout: 30000 }
        );
        
        const info = JSON.parse(stdout);
        
        // 提取格式
        const formats = info.formats
            .filter(f => f.url && f.protocol !== 'm3u8_native')
            .map(f => ({
                quality: f.format_note || f.quality_label || 'unknown',
                resolution: f.resolution || `${f.width}x${f.height}`,
                ext: f.ext,
                url: f.url,
                size: f.filesize || f.filesize_approx
            }))
            .sort((a, b) => {
                const resA = parseInt(a.resolution) || 0;
                const resB = parseInt(b.resolution) || 0;
                return resB - resA;
            });
        
        res.json({
            success: true,
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            uploader: info.uploader,
            formats: formats.slice(0, 10) // 限制返回数量
        });
        
    } catch (error) {
        console.error('Parse error:', error);
        res.status(500).json({
            error: 'Failed to parse video',
            message: error.message
        });
    }
};
```

```json
// package.json
{
  "dependencies": {
    "yt-dlp-wrap": "^2.9.0"
  }
}
```

```json
// vercel.json
{
  "functions": {
    "api/parse.js": {
      "maxDuration": 30
    }
  }
}
```

**限制：**
- 最大执行时间：10s (Hobby) / 60s (Pro)
- 不支持持久化存储
- yt-dlp需要作为依赖安装

---

### 2. Netlify Functions

**免费额度：**
- 每月 125k 请求
- 每月 100GB 带宽

**与Vercel类似，但限制更多：**
- 执行时间：10秒
- 内存：1024MB

```javascript
// netlify/functions/parse.js
exports.handler = async (event, context) => {
    // 同样实现...
};
```

---

### 3. Cloudflare Workers ⭐高性能

**优点：**
- 全球200+数据中心
- 每天 100k 免费请求
- 冷启动时间为0

**缺点：**
- 不支持Python/yt-dlp
- 需要重写为JavaScript
- 50ms CPU时间限制

```javascript
// worker.js
export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }
        
        const { url } = await request.json();
        
        // 调用外部解析API或自实现解析
        const result = await parseVideo(url);
        
        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
};
```

---

## 二、免费 VPS/容器方案

### 1. Railway.app ⭐推荐

**免费额度：**
- 每月 $5 免费额度
- 512MB RAM + 1GB 存储
- 自动休眠（可配合UptimeRobot保持唤醒）

**部署：**

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]
```

```python
# app.py - Flask应用
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import os

app = Flask(__name__)
CORS(app)

@app.route('/api/parse', methods=['POST'])
def parse_video():
    url = request.json.get('url')
    
    if not url:
        return jsonify({'error': 'URL required'}), 400
    
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
                if f.get('url'):
                    formats.append({
                        'quality': f.get('format_note', 'unknown'),
                        'resolution': f.get('resolution', 'unknown'),
                        'ext': f.get('ext'),
                        'url': f.get('url'),
                        'size': f.get('filesize')
                    })
            
            return jsonify({
                'success': True,
                'title': info.get('title'),
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
                'formats': formats[:10]
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
```

```txt
# requirements.txt
flask==3.0.0
flask-cors==4.0.0
yt-dlp==2023.12.30
gunicorn==21.2.0
```

**保持唤醒（防止休眠）：**
```bash
# 使用UptimeRobot或Cron-job.org
# 每5分钟ping一次
curl https://your-app.up.railway.app/api/health
```

---

### 2. Render.com

**免费额度：**
- Web服务：永久免费（休眠后启动慢）
- 512MB RAM
- 自定义域名 + HTTPS

**部署方式：**
- 直接连接GitHub仓库
- 自动部署
- 支持Docker

**限制：**
- 15分钟无访问后休眠
- 唤醒需要30秒左右

---

### 3. Fly.io

**免费额度：**
- 每月 $5 免费额度
- 3个共享CPU VM
- 160GB 出站流量

**特点：**
- 边缘部署（全球节点）
- 支持Docker
- 持久化存储（有限）

```bash
# 部署命令
fly launch
fly deploy
```

---

### 4. Oracle Cloud Free Tier ⭐长期免费

**免费资源（永久）：**
- 2个AMD VM（1核1GB）
- 4个ARM Ampere A1核心 + 24GB内存
- 200GB 块存储
- 10TB 出站流量/月

**优点：**
- 真正的永久免费
- 资源充足
- 可以跑完整服务

**缺点：**
- 需要信用卡验证
- 注册审核较严
- 需要一定技术能力维护

```bash
# 在Oracle VPS上部署
# 1. 创建Ubuntu实例
# 2. 安装依赖
sudo apt update
sudo apt install python3-pip ffmpeg -y

# 3. 部署应用
pip3 install flask flask-cors yt-dlp gunicorn
# 上传app.py
nohup gunicorn -w 2 -b 0.0.0.0:8000 app:app &
```

---

### 5. Google Cloud Run

**免费额度：**
- 每月 200万 请求
- 360,000 GB-seconds 内存
- 180,000 vCPU-seconds

**特点：**
- 按请求计费，空闲时0费用
- 自动扩缩容
- 支持容器

---

## 三、混合方案（推荐架构）

### 最优免费架构

```
┌─────────────────────────────────────────┐
│           CloudFlare Pages              │  ← 前端托管（免费）
│              (590.me)                   │
└─────────────────┬───────────────────────┘
                  │ API请求
┌─────────────────▼───────────────────────┐
│        CloudFlare Workers               │  ← 边缘缓存/路由（免费）
│         (API Gateway)                   │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌───▼───┐   ┌─────▼─────┐
│Vercel │   │Railway│   │Oracle VPS │  ← 解析服务（免费）
│Func 1 │   │Docker │   │  (Backup) │
└───────┘   └───────┘   └───────────┘
```

---

## 四、具体推荐配置

### 方案A：纯Serverless（最简单）

**适用：** 初创、低流量

| 组件 | 服务 | 费用 |
|-----|-----|-----|
| 前端 | CloudFlare Pages | 免费 |
| 后端API | Vercel Functions | 免费 |
| 域名 | Freenom / CloudFlare | 免费 |

**预估月费用：$0**

---

### 方案B：Serverless + 轻量容器（推荐）

**适用：** 中等流量、需要稳定性

| 组件 | 服务 | 费用 |
|-----|-----|-----|
| 前端 | CloudFlare Pages | 免费 |
| 后端API | Railway / Render | 免费 |
| 缓存 | Upstash Redis | 免费(10MB) |
| 监控 | UptimeRobot | 免费 |

**预估月费用：$0**

---

### 方案C：完整VPS（长期稳定）

**适用：** 高流量、需要完全控制

| 组件 | 服务 | 费用 |
|-----|-----|-----|
| 前端 | CloudFlare Pages | 免费 |
| 后端 | Oracle Cloud Free Tier | 免费 |
| 数据库 | SQLite / PostgreSQL (Oracle) | 免费 |
| CDN | CloudFlare | 免费 |

**预估月费用：$0**

---

## 五、部署脚本

### 一键部署到Railway

```bash
#!/bin/bash
# deploy.sh

# 1. 安装Railway CLI
npm install -g @railway/cli

# 2. 登录
railway login

# 3. 初始化项目
railway init

# 4. 部署
railway up

# 5. 获取域名
railway domain

echo "部署完成！"
```

### 一键部署到Vercel

```bash
#!/bin/bash
# deploy-vercel.sh

# 1. 安装Vercel CLI
npm install -g vercel

# 2. 登录
vercel login

# 3. 部署
vercel --prod

echo "部署完成！"
```

---

## 六、注意事项

### 1. 免费服务限制

| 服务 | 主要限制 | 解决方案 |
|-----|---------|---------|
| Vercel | 10s执行时间 | 优化代码，预解析 |
| Railway | 自动休眠 | UptimeRobot保活 |
| Render | 休眠后启动慢 | 预热请求 |
| Oracle | 需要信用卡 | 使用虚拟卡 |

### 2. 防止滥用

```javascript
// 添加请求限制
const rateLimit = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - 60000; // 1分钟窗口
    
    const requests = rateLimit.get(ip) || [];
    const recentRequests = requests.filter(t => t > windowStart);
    
    if (recentRequests.length > 10) { // 每分钟10次
        return false;
    }
    
    recentRequests.push(now);
    rateLimit.set(ip, recentRequests);
    return true;
}
```

### 3. 错误处理

```javascript
// 添加重试机制
async function parseWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await parseVideo(url);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await sleep(1000 * (i + 1));
        }
    }
}
```

---

## 七、推荐选择

### 新手推荐：Vercel + CloudFlare Pages
- 部署最简单
- 文档完善
- 社区支持好

### 稳定推荐：Railway + CloudFlare
- 支持Docker
- 可以跑完整yt-dlp
- 有免费Redis

### 长期推荐：Oracle Cloud Free Tier
- 真正的永久免费
- 资源充足
- 完全控制

---

## 八、快速开始

```bash
# 1. 克隆模板
git clone https://github.com/yourname/590me-backend.git
cd 590me-backend

# 2. 安装依赖
npm install

# 3. 本地测试
npm run dev

# 4. 部署到Vercel
vercel --prod

# 完成！
```
