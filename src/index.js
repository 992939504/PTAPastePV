// Cloudflare Worker - Temporary Content Sharing System

// Security headers for all responses
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

// Rate limiting using KV (simple implementation)
const RATE_LIMIT_KEY_PREFIX = 'ratelimit:';
const RATE_LIMIT_MAX_REQUESTS = 10; // Max requests per minute
const RATE_LIMIT_WINDOW = 60; // 60 seconds

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route handling
    if (path === '/' && request.method === 'GET') {
      return handleHomePage();
    }

    if (path === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    if (path === '/api/view' && request.method === 'POST') {
      return handleView(request, env);
    }

    return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
  }
};

// Utility: Get client IP (use CF-Connecting-IP if available)
function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Utility: Check rate limit
async function checkRateLimit(ip, env) {
  if (!env.CONTENT_KV) return true; // Skip if KV not configured

  const key = RATE_LIMIT_KEY_PREFIX + ip;
  const now = Date.now();
  const windowStart = now - (RATE_LIMIT_WINDOW * 1000);

  try {
    const data = await env.CONTENT_KV.get(key, { type: 'json' });
    
    if (!data) {
      // First request in window
      await env.CONTENT_KV.put(key, JSON.stringify({ count: 1, windowStart }), {
        expirationTtl: RATE_LIMIT_WINDOW
      });
      return true;
    }

    // Check if window has expired
    if (data.windowStart < windowStart) {
      // Reset for new window
      await env.CONTENT_KV.put(key, JSON.stringify({ count: 1, windowStart: now }), {
        expirationTtl: RATE_LIMIT_WINDOW
      });
      return true;
    }

    // Check if limit exceeded
    if (data.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    // Increment counter
    data.count++;
    await env.CONTENT_KV.put(key, JSON.stringify(data), {
      expirationTtl: RATE_LIMIT_WINDOW
    });
    return true;
  } catch (error) {
    console.error('Rate limit error:', error);
    return true; // Allow request if rate limit check fails
  }
}

// Utility: Validate input string
function validateString(input, minLength = 0, maxLength = 10240) {
  if (typeof input !== 'string') return false;
  if (input.length < minLength || input.length > maxLength) return false;
  return true;
}

// Utility: Validate token/password format (alphanumeric only)
function validateToken(token) {
  if (!validateString(token, 16, 16)) return false;
  return /^[A-Za-z0-9]+$/.test(token);
}

// Utility: Validate password format (alphanumeric only)
function validatePassword(password) {
  if (!validateString(password, 16, 16)) return false;
  return /^[A-Za-z0-9]+$/.test(password);
}

// Utility: Validate Content-Type header
function validateContentType(request) {
  const contentType = request.headers.get('Content-Type');
  if (!contentType) return false;
  return contentType.includes('application/json');
}

// Utility: Sanitize content (remove null bytes and control characters)
function sanitizeContent(content) {
  // Remove null bytes and other control characters except newlines and tabs
  return content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Utility: Generate random password (16 characters)
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

// Utility: Generate random token (16 characters)
function generateToken(length = 16) {
  return generatePassword(length);
}

// Utility: Escape HTML special characters to prevent XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Utility: JSON response with security headers
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS
    }
  });
}

// Utility: HTML response with security headers
function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...SECURITY_HEADERS
    }
  });
}

// API: Upload content
async function handleUpload(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    // Validate Content-Type
    if (!validateContentType(request)) {
      return jsonResponse({ success: false, message: 'Invalid Content-Type' }, 400);
    }

    // Rate limiting
    const ip = getClientIp(request);
    if (!(await checkRateLimit(ip, env))) {
      return jsonResponse({ success: false, message: 'Too many requests, please try again later' }, 429);
    }

    // Parse JSON with error handling
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ success: false, message: 'Invalid JSON' }, 400);
    }

    const { content, expiryHours } = body;

    // Validate content
    if (!content || typeof content !== 'string') {
      return jsonResponse({ success: false, message: 'Content is required' }, 400);
    }

    // Content length limit: 10KB
    const MAX_CONTENT_LENGTH = 10 * 1024;
    if (content.length > MAX_CONTENT_LENGTH) {
      return jsonResponse({ success: false, message: 'Content too large (max 10KB)' }, 400);
    }

    // Sanitize content
    const sanitizedContent = sanitizeContent(content);

    // Validate expiry time
    const validExpiryHours = [1, 6, 24, 168]; // 1h, 6h, 24h, 7d
    const hours = expiryHours && validExpiryHours.includes(expiryHours) ? expiryHours : 24;

    // Generate password
    const password = generatePassword();

    // Calculate expiry time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

    // Store in KV (use password as key)
    const data = {
      content: sanitizedContent,
      password,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      views: 0
    };

    await env.CONTENT_KV.put(password, JSON.stringify(data));

    return jsonResponse({
      success: true,
      password,
      expiresAt: expiresAt.toISOString(),
      expiresIn: hours
    });
  } catch (error) {
    console.error('Upload error:', error);
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// API: View content by password
async function handleView(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    // Validate Content-Type
    if (!validateContentType(request)) {
      return jsonResponse({ success: false, message: 'Invalid Content-Type' }, 400);
    }

    // Rate limiting
    const ip = getClientIp(request);
    if (!(await checkRateLimit(ip, env))) {
      return jsonResponse({ success: false, message: 'Too many requests, please try again later' }, 429);
    }

    // Parse JSON with error handling
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ success: false, message: 'Invalid JSON' }, 400);
    }

    const { password } = body;

    // Validate inputs
    if (!password || !validatePassword(password)) {
      return jsonResponse({ success: false, message: 'Invalid password format' }, 400);
    }

    // Get content from KV using password as key
    const contentStr = await env.CONTENT_KV.get(password);

    if (!contentStr) {
      return jsonResponse({ success: false, message: 'Invalid password or content expired' }, 404);
    }

    let data;
    try {
      data = JSON.parse(contentStr);
    } catch (error) {
      return jsonResponse({ success: false, message: 'Invalid data' }, 500);
    }

    // Check expiration
    if (new Date(data.expiresAt) < new Date()) {
      await env.CONTENT_KV.delete(password); // Clean up expired content
      return jsonResponse({ success: false, message: 'Content expired' }, 410);
    }

    // Update view count
    data.views = (data.views || 0) + 1;
    await env.CONTENT_KV.put(password, JSON.stringify(data));

    return jsonResponse({
      success: true,
      content: data.content,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      views: data.views
    });
  } catch (error) {
    console.error('View error:', error);
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// Page: Home page / Upload page
function handleHomePage() {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>TempShare - 临时内容分享</title>
  <meta name="description" content="临时内容分享系统 - 自动过期，安全便捷">
  <meta name="theme-color" content="#000000">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family@&display=swap">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    :root {
      --ios-primary: #007AFF;
      --ios-success: #34C759;
      --ios-warning: #FF9500;
      --ios-danger: #FF3B30;
      --ios-bg: rgba(0, 0, 0, 0.85);
      --ios-fg: #FFFFFF;
      --ios-fg-secondary: rgba(255, 255, 255, 0.6);
      --ios-card: rgba(30, 30, 30, 0.7);
      --ios-border: rgba(255, 255, 255, 0.12);
      --ios-glass: rgba(255, 255, 255, 0.08);
      --ios-shadow: rgba(0, 0, 0, 0.4);
      --blur-amount: 20px;
    }

    @supports (-webkit-backdrop-filter: blur(var(--blur-amount))) {
      .glass {
        -webkit-backdrop-filter: blur(var(--blur-amount));
        backdrop-filter: blur(var(--blur-amount));
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--ios-fg);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Animated background */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: 
        radial-gradient(ellipse at 20% 20%, rgba(120, 119, 198, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(74, 78, 105, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      background: var(--ios-card);
      border: 1px solid var(--ios-border);
      border-radius: 24px;
      box-shadow: 
        0 0 0 0.5px rgba(255, 255, 255, 0.05),
        0 25px 50px -12px var(--ios-shadow),
        inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
      padding: 36px 28px;
      width: 100%;
      max-width: 420px;
      position: relative;
      z-index: 1;
      overflow: hidden;
    }

    .container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 120px;
      background: linear-gradient(180deg, rgba(120, 119, 198, 0.12) 0%, transparent 100%);
      pointer-events: none;
    }

    h1 {
      text-align: center;
      color: var(--ios-fg);
      margin-bottom: 6px;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .subtitle {
      text-align: center;
      color: var(--ios-fg-secondary);
      margin-bottom: 32px;
      font-size: 14px;
      font-weight: 400;
      letter-spacing: 0.2px;
    }

    .form-group {
      margin-bottom: 22px;
    }

    label {
      display: block;
      margin-bottom: 10px;
      color: var(--ios-fg);
      font-weight: 500;
      font-size: 14px;
      letter-spacing: 0.3px;
    }

    textarea, input[type="text"] {
      width: 100%;
      padding: 16px 18px;
      background: var(--ios-glass);
      border: 1px solid var(--ios-border);
      border-radius: 14px;
      font-size: 15px;
      font-family: inherit;
      color: var(--ios-fg);
      resize: vertical;
      min-height: 140px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      -webkit-appearance: none;
      appearance: none;
    }

    textarea::placeholder, input[type="text"]::placeholder {
      color: var(--ios-fg-secondary);
    }

    textarea:focus, input[type="text"]:focus {
      outline: none;
      border-color: var(--ios-primary);
      background: rgba(0, 122, 255, 0.1);
      box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.15);
    }

    select {
      width: 100%;
      padding: 16px 18px;
      background: var(--ios-glass);
      border: 1px solid var(--ios-border);
      border-radius: 14px;
      font-size: 15px;
      font-family: inherit;
      color: var(--ios-fg);
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(255,255,255,0.6)' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 16px center;
    }

    select:focus {
      outline: none;
      border-color: var(--ios-primary);
      background-color: rgba(0, 122, 255, 0.1);
      box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.15);
    }

    select option {
      background: #2c2c2e;
      color: var(--ios-fg);
    }

    button {
      width: 100%;
      padding: 16px;
      background: var(--ios-primary);
      color: white;
      border: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    button::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 50%;
      background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%);
      pointer-events: none;
    }

    button:hover {
      transform: scale(1.02);
      box-shadow: 0 8px 25px rgba(0, 122, 255, 0.4);
    }

    button:active {
      transform: scale(0.98);
    }

    button.secondary {
      background: rgba(255, 255, 255, 0.12);
      color: var(--ios-fg);
      margin-top: 12px;
      border: 1px solid var(--ios-border);
    }

    button.secondary::before {
      background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%);
    }

    button.secondary:hover {
      background: rgba(255, 255, 255, 0.18);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    .message {
      padding: 14px 18px;
      border-radius: 14px;
      margin-bottom: 22px;
      display: none;
      text-align: center;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message.success {
      background: rgba(52, 199, 89, 0.15);
      color: var(--ios-success);
      border: 1px solid rgba(52, 199, 89, 0.3);
    }

    .message.error {
      background: rgba(255, 59, 48, 0.15);
      color: var(--ios-danger);
      border: 1px solid rgba(255, 59, 48, 0.3);
    }

    .result-box {
      background: var(--ios-glass);
      border: 1px solid var(--ios-border);
      border-radius: 18px;
      padding: 24px;
      margin-top: 24px;
      display: none;
      animation: fadeInScale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes fadeInScale {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .result-box h3 {
      color: var(--ios-success);
      margin-bottom: 10px;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .result-box h3::before {
      content: '✓';
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--ios-success);
      color: white;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 700;
    }

    .result-box p {
      color: var(--ios-fg-secondary);
      font-size: 13px;
      margin-bottom: 20px;
      line-height: 1.5;
    }

    .result-item {
      margin-bottom: 18px;
    }

    .result-item:last-child {
      margin-bottom: 0;
    }

    .result-item label {
      display: block;
      margin-bottom: 8px;
      color: var(--ios-fg-secondary);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .result-value {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--ios-border);
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 15px;
      font-family: "SF Mono", Menlo, monospace;
      word-break: break-all;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      transition: all 0.2s ease;
    }

    .result-value:hover {
      background: rgba(0, 0, 0, 0.4);
    }

    .copy-btn {
      padding: 8px 16px;
      background: var(--ios-primary);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .copy-btn:hover {
      background: #0066d6;
      transform: scale(1.05);
    }

    .copy-btn:active {
      transform: scale(0.95);
    }

    .char-count {
      text-align: right;
      color: var(--ios-fg-secondary);
      font-size: 12px;
      margin-top: 8px;
      font-weight: 500;
    }

    .char-count.warning {
      color: var(--ios-warning);
    }

    /* iOS-style segmented control */
    .segmented-control {
      display: flex;
      background: var(--ios-glass);
      border-radius: 12px;
      padding: 4px;
      margin-bottom: 24px;
      border: 1px solid var(--ios-border);
    }

    .segment {
      flex: 1;
      padding: 12px;
      text-align: center;
      font-size: 14px;
      font-weight: 500;
      color: var(--ios-fg-secondary);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .segment.active {
      background: var(--ios-primary);
      color: white;
      box-shadow: 0 4px 12px rgba(0, 122, 255, 0.4);
    }

    /* View content header */
    .view-header {
      text-align: center;
      margin-bottom: 20px;
    }

    .view-header h3 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .view-header p {
      color: var(--ios-fg-secondary);
      font-size: 13px;
    }

    @media (max-width: 480px) {
      .container {
        padding: 28px 20px;
        border-radius: 20px;
      }

      h1 {
        font-size: 24px;
      }

      .result-value {
        flex-direction: column;
        align-items: flex-start;
      }

      .copy-btn {
        width: 100%;
        margin-top: 10px;
      }

      textarea, input[type="text"], select {
        padding: 14px 16px;
      }

      button {
        padding: 14px;
      }
    }

    /* Loading spinner */
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    button.loading {
      opacity: 0.7;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="container glass">
    <h1>TempShare</h1>
    <p class="subtitle">临时内容分享 · 安全便捷</p>

    <!-- Segmented Control -->
    <div class="segmented-control">
      <div class="segment active" id="uploadTab" onclick="switchTab('upload')">上传</div>
      <div class="segment" id="viewTab" onclick="switchTab('view')">查看</div>
    </div>

    <div id="message" class="message"></div>

    <!-- Upload Form -->
    <form id="uploadForm">
      <div class="form-group">
        <label for="content">分享内容</label>
        <textarea id="content" placeholder="输入要分享的内容，最多 10KB..." required maxlength="10240"></textarea>
        <div class="char-count" id="charCount">0 / 10,240</div>
      </div>

      <div class="form-group">
        <label for="expiry">过期时间</label>
        <select id="expiry">
          <option value="1">1 小时</option>
          <option value="6">6 小时</option>
          <option value="24" selected>24 小时</option>
          <option value="168">7 天</option>
        </select>
      </div>

      <button type="submit" id="uploadBtn">创建分享</button>
    </form>

    <!-- Result Box -->
    <div id="resultBox" class="result-box">
      <h3>上传成功</h3>
      <p>请妥善保存访问密码，内容将在指定时间后自动删除</p>

      <div class="result-item">
        <label>访问密码</label>
        <div class="result-value">
          <span id="resultPassword"></span>
          <button class="copy-btn" onclick="copyText('resultPassword')">复制</button>
        </div>
      </div>

      <div class="result-item">
        <label>过期时间</label>
        <div class="result-value">
          <span id="resultExpiry"></span>
        </div>
      </div>

      <button class="secondary" onclick="resetForm()">分享新内容</button>
    </div>

    <!-- View Form -->
    <form id="viewForm" style="display: none;">
      <div class="view-header">
        <h3>查看内容</h3>
        <p>输入访问密码查看内容</p>
      </div>

      <div class="form-group">
        <label for="password">访问密码</label>
        <input type="text" id="password" placeholder="输入 16 位访问密码" required maxlength="16" autocomplete="off">
      </div>

      <button type="submit" id="viewBtn">查看内容</button>
    </form>

    <!-- View Result -->
    <div id="viewResult" class="result-box">
      <h3 style="--ios-success: var(--ios-primary);">📄 内容详情</h3>
      
      <div class="result-item">
        <label>内容</label>
        <div class="result-value" style="align-items: flex-start; min-height: 80px; white-space: pre-wrap;">
          <pre id="viewContent" style="margin: 0; font-family: inherit; font-size: 14px; line-height: 1.5; width: 100%;"></pre>
        </div>
      </div>

      <div class="result-item">
        <label>过期时间</label>
        <div class="result-value">
          <span id="viewExpiry"></span>
        </div>
      </div>

      <div class="result-item">
        <label>访问次数</label>
        <div class="result-value">
          <span id="viewViews"></span>
        </div>
      </div>

      <button class="secondary" onclick="copyText('viewContent')">复制内容</button>
      <button class="secondary" onclick="resetView()">返回</button>
    </div>
  </div>

  <script>
    const MAX_CHARS = 10240;

    // Tab switching
    function switchTab(tab) {
      const uploadTab = document.getElementById('uploadTab');
      const viewTab = document.getElementById('viewTab');
      const uploadForm = document.getElementById('uploadForm');
      const viewForm = document.getElementById('viewForm');
      const resultBox = document.getElementById('resultBox');
      const viewResult = document.getElementById('viewResult');

      if (tab === 'upload') {
        uploadTab.classList.add('active');
        viewTab.classList.remove('active');
        uploadForm.style.display = 'block';
        viewForm.style.display = 'none';
        resultBox.style.display = 'none';
        viewResult.style.display = 'none';
      } else {
        viewTab.classList.add('active');
        uploadTab.classList.remove('active');
        viewForm.style.display = 'block';
        uploadForm.style.display = 'none';
        resultBox.style.display = 'none';
        viewResult.style.display = 'none';
      }
      hideMessage();
    }

    // Character count
    document.getElementById('content').addEventListener('input', function() {
      const count = this.value.length;
      const countEl = document.getElementById('charCount');
      countEl.textContent = count.toLocaleString() + ' / 10,240';
      if (count > MAX_CHARS * 0.9) {
        countEl.classList.add('warning');
      } else {
        countEl.classList.remove('warning');
      }
    });

    // Upload form
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = document.getElementById('content').value;
      const expiryHours = parseInt(document.getElementById('expiry').value);
      const btn = document.getElementById('uploadBtn');

      // Show loading
      btn.classList.add('loading');
      btn.innerHTML = '<span class="spinner"></span>上传中...';

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, expiryHours })
        });

        const result = await response.json();

        // Reset button
        btn.classList.remove('loading');
        btn.textContent = '创建分享';

        if (result.success) {
          document.getElementById('uploadForm').style.display = 'none';
          document.getElementById('resultBox').style.display = 'block';
          document.getElementById('resultPassword').textContent = result.password;
          document.getElementById('resultExpiry').textContent = new Date(result.expiresAt).toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
          });
          showMessage('上传成功！请保存访问密码', 'success');
        } else {
          showMessage(escapeHtml(result.message || '上传失败'), 'error');
        }
      } catch (error) {
        btn.classList.remove('loading');
        btn.textContent = '创建分享';
        showMessage('网络错误，请稍后重试', 'error');
      }
    });

    // View form
    document.getElementById('viewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value.trim();
      const btn = document.getElementById('viewBtn');

      if (password.length !== 16) {
        showMessage('密码必须是 16 位字符', 'error');
        return;
      }

      // Show loading
      btn.classList.add('loading');
      btn.innerHTML = '<span class="spinner"></span>加载中...';

      try {
        const response = await fetch('/api/view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const result = await response.json();

        // Reset button
        btn.classList.remove('loading');
        btn.textContent = '查看内容';

        if (result.success) {
          document.getElementById('viewForm').style.display = 'none';
          document.getElementById('viewResult').style.display = 'block';
          document.getElementById('viewContent').textContent = result.content;
          document.getElementById('viewExpiry').textContent = new Date(result.expiresAt).toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
          });
          document.getElementById('viewViews').textContent = result.views + ' 次';
        } else {
          showMessage(escapeHtml(result.message || '查看失败'), 'error');
        }
      } catch (error) {
        btn.classList.remove('loading');
        btn.textContent = '查看内容';
        showMessage('网络错误，请稍后重试', 'error');
      }
    });

    // Copy text
    function copyText(elementId) {
      const text = document.getElementById(elementId).textContent;
      if (!text) return;
      
      navigator.clipboard.writeText(text).then(() => {
        showMessage('已复制到剪贴板', 'success');
      }).catch(() => {
        showMessage('复制失败', 'error');
      });
    }

    // Reset forms
    function resetForm() {
      document.getElementById('content').value = '';
      document.getElementById('charCount').textContent = '0 / 10,240';
      document.getElementById('charCount').classList.remove('warning');
      document.getElementById('resultBox').style.display = 'none';
      document.getElementById('uploadForm').style.display = 'block';
      switchTab('upload');
    }

    function resetView() {
      document.getElementById('password').value = '';
      document.getElementById('viewResult').style.display = 'none';
      document.getElementById('viewForm').style.display = 'block';
      hideMessage();
    }

    // Show/hide message
    function showMessage(text, type) {
      const msg = document.getElementById('message');
      msg.textContent = text;
      msg.className = 'message ' + type;
      msg.style.display = 'block';
      setTimeout(() => {
        hideMessage();
      }, 4000);
    }

    function hideMessage() {
      document.getElementById('message').style.display = 'none';
    }

    // Escape HTML
    function escapeHtml(text) {
      if (typeof text !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>
  `;
  return htmlResponse(html);
}