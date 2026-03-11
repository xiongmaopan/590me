# 修复 Wrangler 问题

## 问题原因
Wrangler 在调用 `/memberships` API 时失败，因为 API Token 缺少 **成员资格读取** 权限。

## 解决方案

### 方案1：添加缺失权限（推荐）

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 找到你的 Token `q5QWLSQtrjdq5qKR9rCzmKmVRuG-27ZLiT1D63ZF`
3. 点击 **编辑**
4. 点击 **"添加更多"**
5. 添加权限：
   - **账户** > **成员资格** 或 **成员管理** > **读取**
6. 滚动到底部，点击 **继续以显示摘要**
7. 点击 **保存令牌**

### 方案2：使用 OAuth 登录（绕过Token）

在 PowerShell 中执行：

```powershell
cd d:\CODEFREE\590me

# 清除环境变量
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $null, "User")
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $null, "Machine")

# 删除 wrangler 配置
Remove-Item -Path ".wrangler" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:USERPROFILE\.wrangler" -Recurse -Force -ErrorAction SilentlyContinue

# 使用 OAuth 登录
npx wrangler login

# 浏览器会打开，登录你的 CloudFlare 账号
# 登录成功后，再部署
npx wrangler pages deploy . --project-name=590me --branch=main
```

### 方案3：使用 Global API Key

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点击 **"获取您的 API 令牌"**（在页面底部）
3. 复制 **Global API Key**
4. 使用以下命令：

```powershell
cd d:\CODEFREE\590me
$env:CLOUDFLARE_API_KEY = "你的Global API Key"
$env:CLOUDFLARE_EMAIL = "你的CF邮箱"
npx wrangler pages deploy . --project-name=590me --branch=main
```

## 验证修复

修复后，运行以下命令测试：

```powershell
cd d:\CODEFREE\590me
npx wrangler whoami
npx wrangler pages deploy . --project-name=590me --branch=main
```

## 如果都失败

使用 **手动上传** 方式：
1. 打开 https://dash.cloudflare.com
2. 点击 **Pages** → **创建项目** → **上传资产**
3. 选择 `d:\CODEFREE\590me\index.html`
4. 项目名：**590me**
5. 点击 **部署**
