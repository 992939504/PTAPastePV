# Cloudflare Worker 密码内容管理系统 - 项目计划书

## 1. 项目概述

### 1.1 项目名称
**SecureContent Worker** - 基于密码的内容分享系统

### 1.2 项目目标
创建一个运行在Cloudflare Worker上的轻量级内容分享系统，用户通过输入密码访问对应的文字内容，支持PC和移动端浏览器。

## 2. 功能需求

### 2.1 核心功能
| 功能 | 描述 |
|------|------|
| 密码验证 | 用户输入密码，验证后显示对应内容 |
| 内容展示 | 展示密码关联的所有文字内容 |
| 一键复制 | 每条内容支持一键复制到剪贴板 |
| 响应式设计 | 自适应PC和移动端浏览器 |

### 2.2 可选扩展功能
- 管理员后台（添加/删除密码和内容）
- 访问次数限制
- 密码过期时间

## 3. 技术架构

### 3.1 技术栈
```
前端: HTML5 + CSS3 + Vanilla JavaScript
后端: Cloudflare Worker (JavaScript)
存储: Cloudflare KV (键值存储)
```

### 3.2 数据结构设计
```javascript
// KV存储结构
// Key: password_hash (密码的哈希值)
// Value: JSON字符串
{
  "title": "内容标题",
  "items": [
    { "label": "标签1", "content": "可复制内容1" },
    { "label": "标签2", "content": "可复制内容2" }
  ],
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": null  // 可选过期时间
}
```

### 3.3 API设计
| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 返回登录页面 |
| `/api/verify` | POST | 验证密码并返回内容 |
| `/api/admin/add` | POST | 添加新密码和内容 |
| `/api/admin/delete` | POST | 删除密码和内容 |
| `/api/admin/list` | POST | 列出所有密码（仅标题） |

## 4. 项目结构

```
secure-content-worker/
├── src/
│   └── index.js          # Worker入口文件（包含所有逻辑）
├── wrangler.toml         # Cloudflare配置
├── package.json          # 项目配置
├── PLAN.md               # 本计划书
└── README.md             # 使用说明
```

## 5. 页面设计

### 5.1 登录页面
- 简洁的密码输入框
- 提交按钮
- 错误提示区域
- 管理入口链接

### 5.2 内容展示页面
- 内容标题
- 内容列表（卡片式布局）
- 每个卡片包含：标签、内容、复制按钮
- 返回/退出按钮

### 5.3 管理页面
- 管理员密码验证
- 添加新密码和内容
- 查看/删除现有内容

### 5.4 响应式断点
- 移动端: < 768px (单列布局)
- PC端: >= 768px (双列网格布局)

## 6. 安全考虑

1. **密码存储**: 使用SHA-256哈希存储密码
2. **防暴力破解**: 实现请求频率限制
3. **HTTPS**: Cloudflare默认提供SSL
4. **XSS防护**: 内容输出时进行HTML转义
5. **管理员验证**: 管理操作需要管理员密码

## 7. 实施步骤

- [x] 编写项目计划书
- [x] 创建项目结构和配置文件
- [ ] 实现Worker主入口文件
- [ ] 实现密码验证API
- [ ] 实现前端页面（响应式设计）
- [ ] 实现管理功能
- [ ] 测试和优化

## 8. 部署说明

### 8.1 首次部署
```bash
# 1. 安装依赖
npm install

# 2. 登录Cloudflare
npx wrangler login

# 3. 创建KV命名空间
npx wrangler kv:namespace create CONTENT_KV

# 4. 更新wrangler.toml中的KV namespace ID

# 5. 部署
npm run deploy
```

### 8.2 本地开发
```bash
# 启动本地开发服务器
npm run dev
```

## 9. 使用说明

### 9.1 用户使用
1. 访问Worker URL
2. 输入密码
3. 查看并复制内容

### 9.2 管理员使用
1. 点击"管理入口"
2. 输入管理员密码
3. 添加/删除密码和内容
