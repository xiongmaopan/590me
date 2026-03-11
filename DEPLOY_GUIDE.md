# 590.me 部署指南 - CloudFlare Pages + Vercel

## 架构图

```
┌─────────────────────────────────────────┐
│         CloudFlare Pages                │  ← 前端托管
│           (590.me)                      │     免费 + 全球CDN
└─────────────────┬───────────────────────┘
                  │ API请求
┌─────────────────▼───────────────────────┐
│      Vercel Serverless Functions        │  ← 后端解析API
│         (api.590.me)                    │     免费 + yt-dlp
└─────────────────────────────────────────┘
```

---

## 第一步：部署后端到 Vercel

### 1.1 准备工作

```bash
# 安装 Vercel CLI
npm install -g vercel

# 登录 Vercel
vercel login
```

### 1.2 项目结构确认

确保项目结构如下：
```
590me/
├── api/
│   └── parse.js          # 解析API
├── package.json          # 依赖配置
├── vercel.json           # Vercel配置
└── index.html            # 前端页面
```

### 1.3 部署

```bash
# 进入项目目录
cd d:/CODEFREE/590me

# 部署到 Vercel
vercel --prod

# 按提示操作：
# ? Set up and deploy "...\590me"? [Y/n] Y
# ? Which scope do you want to deploy to? [你的账号]
# ? Link to existing project? [y/N] n
# ? What's your project name? [590me-api]
# ? In which directory is your code located? ./
```

### 1.4 配置环境变量（可选）

```bash
# 如果需要设置环境变量
vercel env add NODE_ENV production
```

### 1.5 获取API地址

部署成功后，你会得到类似：
```
https://590me-api.vercel.app
```

API地址为：
```
https://590me-api.vercel.app/api/parse
```

---

## 第二步：部署前端到 CloudFlare Pages

### 2.1 准备工作

1. 注册/登录 CloudFlare 账号：https://dash.cloudflare.com
2. 确保域名已添加到 CloudFlare（或使用 pages.dev 子域名）

### 2.2 创建 Pages 项目

**方式A：通过Git（推荐）**

```bash
# 初始化Git仓库
git init
git add .
git commit -m "Initial commit"

# 创建GitHub仓库并推送
git remote add origin https://github.com/yourname/590me.git
git push -u origin main
```

然后在 CloudFlare Dashboard：
1. 进入 **Pages** → **Create a project**
2. 选择 **Connect to Git**
3. 选择 GitHub 仓库
4. 配置构建设置：
   - **Framework preset:** None
   - **Build command:** （留空，纯静态）
   - **Build output directory:** （留空，根目录）
5. 点击 **Save and Deploy**

**方式B：直接上传**

1. 进入 **Pages** → **Create a project**
2. 选择 **Upload assets**
3. 拖拽项目文件夹上传
4. 点击 **Deploy**

### 2.3 配置自定义域名（可选）

1. 在 Pages 项目设置中，点击 **Custom domains**
2. 添加域名：`590.me`
3. 按提示添加 DNS 记录
4. 等待 SSL 证书生成（通常几分钟）

---

## 第三步：更新前端API地址

### 3.1 修改 index.html

找到这段代码：
```javascript
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : 'https://api.590.me/api'; // 部署后替换为实际API地址
```

替换为你的 Vercel API 地址：
```javascript
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : 'https://590me-api.vercel.app/api';
```

### 3.2 重新部署前端

如果使用Git：
```bash
git add .
git commit -m "Update API endpoint"
git push
```

CloudFlare Pages 会自动重新部署。

---

## 第四步：配置 CORS（如需要）

如果前端和后端域名不同，确保 `api/parse.js` 中的CORS设置正确：

```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
// 或者指定域名：
res.setHeader('Access-Control-Allow-Origin', 'https://590.me');
```

---

## 第五步：测试

### 5.1 本地测试

```bash
# 启动本地开发服务器
vercel dev

# 访问 http://localhost:3000
```

### 5.2 生产环境测试

1. 访问你的前端地址：`https://590.me` 或 `https://590me.pages.dev`
2. 粘贴 YouTube/TikTok 视频链接
3. 点击 Download 按钮
4. 检查是否返回视频信息和下载选项

---

## 常见问题

### Q1: Vercel 部署失败，提示 yt-dlp 未找到

**解决：** 在 Vercel 项目设置中添加 Python 依赖

创建 `requirements.txt`：
```txt
yt-dlp==2023.12.30
```

修改 `vercel.json`：
```json
{
  "builds": [
    {
      "src": "api/parse.js",
      "use": "@vercel/node"
    }
  ],
  "buildCommand": "pip install -r requirements.txt"
}
```

### Q2: 解析超时（10秒限制）

**解决：** 
- 升级到 Vercel Pro（60秒限制）
- 或者使用 Railway/Render 替代

### Q3: CORS 错误

**解决：** 确保 `api/parse.js` 中设置了正确的CORS头：
```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
```

### Q4: 某些视频解析失败

**原因：**
- 视频需要登录（私人视频）
- 平台更新了反爬机制
- 地区限制

**解决：**
- 更新 yt-dlp：`pip install -U yt-dlp`
- 检查错误日志

---

## 费用预估

| 服务 | 免费额度 | 预估用量 | 费用 |
|-----|---------|---------|-----|
| CloudFlare Pages | 无限请求 | 中等流量 | **$0** |
| Vercel Functions | 100GB/月 | ~50GB/月 | **$0** |
| **总计** | | | **$0/月** |

---

## 监控和维护

### 添加 Uptime 监控

注册 [UptimeRobot](https://uptimerobot.com/)，监控：
- `https://590.me` (前端)
- `https://590me-api.vercel.app/api/parse` (后端)

### 定期更新

```bash
# 更新 yt-dlp
npm update yt-dlp-wrap

# 或者 Python 版本
pip install -U yt-dlp
```

---

## 下一步优化

1. **添加缓存：** 使用 Upstash Redis（免费）
2. **添加分析：** 使用 CloudFlare Analytics
3. **错误监控：** 使用 Sentry（免费额度）
4. **Rate Limiting：** 已内置，可调参数

---

## 快速检查清单

- [ ] Vercel 后端部署成功
- [ ] CloudFlare Pages 前端部署成功
- [ ] API 地址已更新到前端代码
- [ ] CORS 配置正确
- [ ] 测试 YouTube 视频解析
- [ ] 测试 TikTok 视频解析
- [ ] 添加 Uptime 监控

完成！🎉
