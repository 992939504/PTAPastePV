# Secure Content Worker

基于Cloudflare Worker的密码保护内容分享系统，支持PC和移动端浏览器。

## 功能特性

- 🔐 密码保护访问
- 📋 一键复制内容
- 📱 响应式设计（PC/移动端）
- 🔧 管理员后台
- ⚡ 快速部署（Cloudflare边缘网络）
- 🔒 SHA-256密码哈希

## 快速开始

### 1. 安装依赖

```bash
cd secure-content-worker
npm install
```

### 2. 登录Cloudflare

```bash
npx wrangler login
```

### 3. 创建KV命名空间

```bash
# 创建生产环境KV
npx wrangler kv:namespace create CONTENT_KV

# 创建预览环境KV（用于本地开发）
npx wrangler kv:namespace create CONTENT_KV --preview
```

命令执行后会返回类似以下内容：
```
{ binding = "CONTENT_KV", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
{ binding = "CONTENT_KV", preview_id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" }
```

### 4. 配置wrangler.toml

将上一步获得的ID填入`wrangler.toml`文件：

```toml
[[kv_namespaces]]
binding = "CONTENT_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
preview_id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

同时修改管理员密码：
```toml
[vars]
ADMIN_PASSWORD = "your-secure-admin-password"
```

### 5. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787` 进行测试。

### 6. 部署到Cloudflare

```bash
npm run deploy
```

部署成功后会显示Worker的URL，例如：`https://secure-content-worker.your-subdomain.workers.dev`

## 使用说明

### 用户端使用

1. 访问Worker URL
2. 输入密码
3. 查看内容并复制

### 管理员使用

1. 访问 `https://your-worker-url/admin`
2. 输入管理员密码（在wrangler.toml中配置）
3. 添加新的密码和内容：
   - 输入用户密码（用户访问时使用）
   - 输入标题
   - 添加多个内容项（标签+内容）
   - 点击"Add Content"
4. 管理现有内容：
   - 点击"Load Content List"查看所有内容
   - 点击"Delete"删除不需要的内容

## 数据结构

每个密码对应的内容结构：

```json
{
  "title": "示例标题",
  "items": [
    {
      "label": "API Key",
      "content": "sk-xxxxxxxxxxxxxxxx"
    },
    {
      "label": "Database URL",
      "content": "postgresql://user:pass@host:5432/db"
    }
  ],
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": null
}
```

## 安全说明

1. **密码存储**：用户密码使用SHA-256哈希后存储在KV中
2. **管理员密码**：存储在环境变量中，不要使用弱密码
3. **HTTPS**：Cloudflare自动提供SSL证书
4. **XSS防护**：所有用户输入都经过HTML转义

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

## API端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 登录页面 |
| `/admin` | GET | 管理员页面 |
| `/api/verify` | POST | 验证密码并返回内容 |
| `/api/admin/add` | POST | 添加新内容 |
| `/api/admin/delete` | POST | 删除内容 |
| `/api/admin/list` | POST | 列出所有内容 |

## 常见问题

### Q: 如何修改管理员密码？
A: 编辑`wrangler.toml`文件中的`ADMIN_PASSWORD`，然后重新部署。

### Q: 如何删除所有数据？
A: 在Cloudflare Dashboard中找到KV命名空间，手动删除所有键值对。

### Q: 支持密码过期吗？
A: 当前版本支持`expiresAt`字段，但需要手动在添加内容时指定。

### Q: 如何限制访问次数？
A: 需要额外开发，可以在KV中记录访问次数并在验证时检查。

## 技术栈

- **运行环境**: Cloudflare Workers
- **存储**: Cloudflare KV
- **前端**: HTML5 + CSS3 + Vanilla JavaScript
- **后端**: JavaScript (ES6+)

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request。
