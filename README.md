# TempShare - 临时内容分享系统

基于 Cloudflare Worker 的临时内容分享系统，任何人都可以上传内容，系统自动生成访问密码，内容自动过期删除。

## 功能特性

- 🚀 **无需注册** - 任何人都可以上传内容
- 🔐 **自动生成密码** - 系统自动生成 16 位随机访问密码
- ⏰ **自动过期** - 内容在设定时间后自动删除（1小时/6小时/24小时/7天）
- 📋 **一键复制** - 快速复制内容到剪贴板
- 📱 **响应式设计** - 完美支持 PC 和移动端
- ⚡ **快速部署** - 基于 Cloudflare 边缘网络
- 🔒 **安全可靠** - 内容自动过期清理

## 访问地址

https://secure-content-worker.zxcvnmchina.workers.dev

## 使用说明

### 上传内容

1. 访问上述网址
2. 在文本框中输入要分享的内容（最多 10KB）
3. 选择过期时间（1小时/6小时/24小时/7天）
4. 点击"上传内容"
5. **重要**：保存生成的 16 位访问密码

### 查看内容

1. 访问网址
2. 点击"查看内容"
3. 输入访问密码
4. 查看并复制内容

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 首页/上传页面 |
| `/api/upload` | POST | 上传内容 |
| `/api/view` | POST | 通过密码查看内容 |

## API 请求示例

### 上传内容

```bash
curl -X POST https://secure-content-worker.zxcvnmchina.workers.dev/api/upload \
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
curl -X POST https://secure-content-worker.zxcvnmchina.workers.dev/api/view \
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
│   └── index.js          # Worker 主文件
├── wrangler.toml         # Cloudflare 配置
├── package.json          # 项目配置
├── PLAN.md               # 项目计划书
└── README.md             # 本文件
```

## 本地开发

```bash
# 安装依赖
npm install

# 本地测试
npm run deploy

# 部署到生产
npm run deploy

# 查看日志
npm run tail
```

## 部署说明

### 方式一：命令行部署

```bash
# 登录 Cloudflare
npx wrangler login

# 部署
npm run deploy
```

### 方式二：GitHub + Cloudflare 自动部署

1. 将代码推送到 GitHub 仓库
2. 在 Cloudflare Dashboard 创建 Workers & Pages 应用
3. 连接 GitHub 仓库
4. 自动部署

## 技术栈

- **运行环境**: Cloudflare Workers
- **存储**: Cloudflare KV
- **前端**: HTML5 + CSS3 + Vanilla JavaScript

## 许可证

MIT License
