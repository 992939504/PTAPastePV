# Cloudflare Worker 临时内容分享系统 - 项目计划书

## 1. 项目概述

### 1.1 项目名称
**TempShare Worker** - 临时内容分享系统

### 1.2 项目目标
创建一个运行在Cloudflare Worker上的临时内容分享系统，任何人都可以上传内容，系统会生成访问密码，内容自动过期删除。

## 2. 功能需求

### 2.1 核心功能
| 功能 | 描述 |
|------|------|
| 上传内容 | 任何人都可以上传文字内容，无需登录 |
| 自动生成密码 | 系统自动生成随机访问密码 |
| 自动过期 | 内容在设定时间后自动删除（默认24小时） |
| 密码访问 | 通过密码访问对应内容 |
| 一键复制 | 内容支持一键复制到剪贴板 |
| 响应式设计 | 自适应PC和移动端浏览器 |

### 2.2 用户流程
1. 用户访问首页
2. 输入内容，选择过期时间（1小时/6小时/24小时/7天）
3. 点击上传
4. 系统返回访问密码和过期时间
5. 用户保存密码，可以分享给他人
6. 访问者输入密码查看内容

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
// Key: 随机生成的token (16位随机字符串)
// Value: JSON字符串
{
  "content": "用户输入的内容",
  "password": "自动生成的访问密码",
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": "2024-01-02T00:00:00Z",  // 过期时间
  "views": 0  // 访问次数（可选）
}
```

### 3.3 API设计
| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 首页（上传页面） |
| `/api/upload` | POST | 上传内容 |
| `/api/view` | POST | 通过密码查看内容 |

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

### 5.1 首页/上传页面
- 内容输入框（textarea，多行文本）
- 过期时间选择器（1小时/6小时/24小时/7天）
- 上传按钮
- 上传成功提示（显示密码和过期时间）
- 查看内容链接

### 5.2 查看页面
- 密码输入框
- 提交按钮
- 错误提示区域
- 内容展示区域
- 一键复制按钮
- 返回上传页面按钮

### 5.3 响应式断点
- 移动端: < 768px (单列布局)
- PC端: >= 768px (最大宽度限制)

## 6. 安全考虑

1. **密码生成**: 使用安全的随机数生成器生成16位随机密码
2. **内容验证**: 限制内容最大长度（例如10KB）
3. **XSS防护**: 内容输出时进行HTML转义
4. **HTTPS**: Cloudflare默认提供SSL
5. **自动过期**: 内容过期后无法访问

## 7. 实施步骤

- [x] 编写项目计划书
- [x] 创建项目结构和配置文件
- [ ] 实现Worker主入口文件
- [ ] 实现内容上传API
- [ ] 实现密码查看API
- [ ] 实现前端页面（响应式设计）
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

### 9.1 上传内容
1. 访问Worker URL
2. 输入要分享的内容
3. 选择过期时间
4. 点击上传
5. 保存生成的访问密码

### 9.2 查看内容
1. 访问Worker URL
2. 输入访问密码
3. 查看并复制内容

## 10. 技术细节

### 10.1 密码生成
```javascript
function generatePassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}
```

### 10.2 过期时间选项
- 1小时: 60 * 60 * 1000 ms
- 6小时: 6 * 60 * 60 * 1000 ms
- 24小时: 24 * 60 * 60 * 1000 ms
- 7天: 7 * 24 * 60 * 60 * 1000 ms

### 10.3 内容长度限制
- 最大内容长度: 10KB
- 如果超过限制，返回错误提示