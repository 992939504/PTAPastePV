# TempShare Worker

基于Cloudflare Worker的临时内容分享系统，任何人都可以上传内容，系统自动生成访问密码，内容自动过期删除。

## 功能特性

- 🚀 **无需注册** - 任何人都可以上传内容
- 🔐 **自动生成密码** - 系统自动生成16位随机访问密码
- ⏰ **自动过期** - 内容在设定时间后自动删除（1小时/6小时/24小时/7天）
- 📋 **一键复制** - 快速复制内容到剪贴板
- 📱 **响应式设计** - 完美支持PC和移动端
- ⚡ **快速部署** - 基于Cloudflare边缘网络
- 🔒 **安全可靠** - 内容加密存储，自动过期清理

## 快速开始

### 方法一：命令行部署

#### 1. 安装依赖

```bash
cd secure-content-worker
npm install
```

#### 2. 登录Cloudflare

```bash
npx wrangler login
```

#### 3. 创建KV命名空间

```bash
npx wrangler kv:namespace create CONTENT_KV
```

命令执行后会返回类似以下内容：
```
{ binding = "CONTENT_KV", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

#### 4. 配置wrangler.toml

将上一步获得的ID填入`wrangler.toml`文件：

```toml
[[kv_namespaces]]
binding = "CONTENT_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

#### 5. 部署

```bash
npm run deploy
```

部署成功后会显示Worker的URL。

---

### 方法二：通过 Cloudflare Dashboard 部署（推荐）

适合从 GitHub 仓库 fork 后直接部署。

#### 1. Fork 仓库

将本仓库 fork 到你的 GitHub 账号。

#### 2. 连接 Cloudflare

1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages
3. 点击 Create application
4. 选择 Pages（或 Workers）
5. 连接你的 GitHub 账号
6. 选择 fork 后的仓库

#### 3. 创建 KV 命名空间

1. 在 Cloudflare Dashboard 左侧菜单找到 KV
2. 点击 Create namespace
3. 输入名称 `CONTENT_KV`
4. 记下生成的 Namespace ID

#### 4. 配置 Worker

1. 进入 Workers & Pages
2. 点击你的 Worker
3. 进入 Settings → Variables

**添加 KV 绑定：**
- Variable name: `CONTENT_KV`
- KV namespace: 选择刚创建的命名空间

#### 5. 重新部署

保存设置后，Worker 会自动重新部署。

## 使用说明

### 上传内容

1. 访问 Worker URL
2. 在文本框中输入要分享的内容（最多10KB）
3. 选择过期时间（1小时/6小时/24小时/7天）
4. 点击"上传内容"
5. **重要**：保存生成的16位访问密码

### 查看内容

1. 访问 Worker URL
2. 点击"查看内容"
3. 输入访问密码
4. 查看并复制内容

## 数据结构

每个上传的内容结构：

```json
{
  "content": "用户输入的内容",
  "password": "自动生成的16位访问密码",
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": "2024-01-02T00:00:00Z",
  "views": 0
}
```

## 安全说明

1. **密码生成**：使用安全的随机数生成器生成16位随机密码
2. **内容限制**：内容最大长度限制为10KB
3. **HTTPS**：Cloudflare自动提供SSL证书
4. **XSS防护**：所有用户输入都经过HTML转义
5. **自动过期**：内容过期后无法访问，自动清理

## API端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 首页/上传页面 |
| `/api/upload` | POST | 上传内容 |
| `/api/view` | POST | 通过密码查看内容 |

## API 请求示例

### 上传内容

```bash
curl -X POST https://your-worker.workers.dev/api/upload \
  -H "Content-Type: application/json" \
  -d '{
    "content": "这是要分享的内容",
    "expiryHours": 24
  }'
```

响应：
```json
{
  "success": true,
  "token": "abc123def456",
  "password": "Xy9zAb2cD3eF4gH5",
  "expiresAt": "2024-01-02T00:00:00Z",
  "expiresIn": 24
}
```

### 查看内容

```bash
curl -X POST https://your-worker.workers.dev/api/view \
  -H "Content-Type: application/json" \
  -d '{
    "token": "abc123def456",
    "password": "Xy9zAb2cD3eF4gH5"
  }'
```

响应：
```json
{
  "success": true,
  "content": "这是要分享的内容",
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": "2024-01-02T00:00:00Z",
  "views": 1
}
```

## 项目结构

```
secure-content-worker/
├── src/
│   └── index.js          # Worker主文件
├── wrangler.toml         # Cloudflare配置
├── package.json          # 项目配置
├── PLAN.md               # 项目计划书
└── README.md             # 本文件
```

## 常见问题

### Q: 我忘记了访问密码怎么办？
A: 很抱歉，密码无法找回。系统不会保存密码的明文，出于安全考虑，请妥善保存访问密码。

### Q: 内容过期后还能恢复吗？
A: 不能。过期后内容会被自动删除，无法恢复。

### Q: 最大可以上传多少内容？
A: 目前限制为10KB，适合分享文本内容如代码片段、配置信息等。

### Q: 可以修改上传的内容吗？
A: 不可以。上传后内容无法修改，如需更新请重新上传。

### Q: 内容会被其他人看到吗？
A: 只有知道访问密码的人才能查看内容。请确保密码的安全性。

### Q: 如何删除已上传的内容？
A: 内容会在过期时间后自动删除。如需立即删除，请联系管理员。

## 技术栈

- **运行环境**: Cloudflare Workers
- **存储**: Cloudflare KV
- **前端**: HTML5 + CSS3 + Vanilla JavaScript
- **后端**: JavaScript (ES6+)

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request。