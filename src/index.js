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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TempShare - 临时内容分享</title>
  <meta name="description" content="临时内容分享系统 - 自动过期，安全便捷">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      padding: 40px;
      width: 100%;
      max-width: 600px;
    }

    h1 {
      text-align: center;
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }

    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
      font-size: 14px;
    }

    textarea {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      font-family: monospace;
      resize: vertical;
      min-height: 150px;
      transition: border-color 0.3s;
    }

    textarea:focus {
      outline: none;
      border-color: #667eea;
    }

    select {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      background: white;
      cursor: pointer;
      transition: border-color 0.3s;
    }

    select:focus {
      outline: none;
      border-color: #667eea;
    }

    input[type="text"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
    }

    input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
    }

    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: translateY(0);
    }

    button.secondary {
      background: #6c757d;
      margin-top: 10px;
    }

    button.secondary:hover {
      background: #5a6268;
    }

    .message {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
      text-align: center;
      font-size: 14px;
    }

    .message.success {
      background: #d4edda;
      color: #155724;
    }

    .message.error {
      background: #f8d7da;
      color: #721c24;
    }

    .result-box {
      background: #f8f9fa;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
      display: none;
    }

    .result-box h3 {
      color: #333;
      margin-bottom: 15px;
      font-size: 16px;
    }

    .result-item {
      margin-bottom: 15px;
    }

    .result-item label {
      display: block;
      margin-bottom: 5px;
      color: #666;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .result-value {
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 10px;
      font-family: monospace;
      font-size: 14px;
      word-break: break-all;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .copy-btn {
      padding: 6px 12px;
      background: #28a745;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    .copy-btn:hover {
      background: #218838;
    }

    .char-count {
      text-align: right;
      color: #999;
      font-size: 12px;
      margin-top: 5px;
    }

    .char-count.warning {
      color: #dc3545;
    }

    @media (max-width: 768px) {
      .container {
        padding: 30px 20px;
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
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📝 TempShare</h1>
    <p class="subtitle">临时内容分享 - 自动过期，安全便捷</p>

    <div id="message" class="message"></div>

    <form id="uploadForm">
      <div class="form-group">
        <label for="content">内容 (最多 10KB)</label>
        <textarea id="content" placeholder="输入要分享的内容..." required maxlength="10240"></textarea>
        <div class="char-count" id="charCount">0 / 10240 字符</div>
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

      <button type="submit">上传内容</button>
      <button type="button" class="secondary" onclick="showViewForm()">查看内容</button>
    </form>

    <div id="resultBox" class="result-box">
      <h3>✅ 上传成功！</h3>
      <p style="color: #666; font-size: 13px; margin-bottom: 15px;">请妥善保存以下信息，内容将在指定时间后自动删除</p>

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

      <button class="secondary" onclick="resetForm()">上传新内容</button>
    </div>

    <form id="viewForm" style="display: none;">
      <div class="form-group">
        <label for="token">访问 Token (可选)</label>
        <input type="text" id="token" placeholder="Token（如果已知）">
      </div>

      <div class="form-group">
        <label for="password">访问密码</label>
        <input type="text" id="password" placeholder="输入访问密码" required maxlength="16">
      </div>

      <button type="submit">查看内容</button>
      <button type="button" class="secondary" onclick="showUploadForm()">返回上传</button>
    </form>

    <div id="viewResult" class="result-box">
      <h3>📄 内容</h3>
      <div class="result-item">
        <label>内容</label>
        <div class="result-value" style="align-items: flex-start;">
          <pre id="viewContent" style="margin: 0; white-space: pre-wrap; word-break: break-all;"></pre>
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

    // Character count
    document.getElementById('content').addEventListener('input', function() {
      const count = this.value.length;
      const countEl = document.getElementById('charCount');
      countEl.textContent = count + ' / ' + MAX_CHARS + ' 字符';
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

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, expiryHours })
        });

        const result = await response.json();

        if (result.success) {
          document.getElementById('uploadForm').style.display = 'none';
          document.getElementById('viewForm').style.display = 'none';
          document.getElementById('resultBox').style.display = 'block';
          document.getElementById('resultPassword').textContent = result.password;
          document.getElementById('resultExpiry').textContent = new Date(result.expiresAt).toLocaleString();
          showMessage('上传成功！请保存访问密码', 'success');
        } else {
          showMessage(escapeHtml(result.message || '上传失败'), 'error');
        }
      } catch (error) {
        showMessage('网络错误', 'error');
      }
    });

    // View form
    document.getElementById('viewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value.trim();

      if (password.length !== 16) {
        showMessage('密码必须是16位字符', 'error');
        return;
      }

      try {
        const response = await fetch('/api/view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const result = await response.json();

        if (result.success) {
          document.getElementById('uploadForm').style.display = 'none';
          document.getElementById('viewForm').style.display = 'none';
          document.getElementById('viewResult').style.display = 'block';
          // Use textContent to prevent XSS
          document.getElementById('viewContent').textContent = result.content;
          document.getElementById('viewExpiry').textContent = new Date(result.expiresAt).toLocaleString();
          document.getElementById('viewViews').textContent = result.views;
        } else {
          showMessage(escapeHtml(result.message || '查看失败'), 'error');
        }
      } catch (error) {
        showMessage('网络错误', 'error');
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

    // Show/hide forms
    function showViewForm() {
      document.getElementById('uploadForm').style.display = 'none';
      document.getElementById('resultBox').style.display = 'none';
      document.getElementById('viewResult').style.display = 'none';
      document.getElementById('viewForm').style.display = 'block';
    }

    function showUploadForm() {
      document.getElementById('viewForm').style.display = 'none';
      document.getElementById('resultBox').style.display = 'none';
      document.getElementById('viewResult').style.display = 'none';
      document.getElementById('uploadForm').style.display = 'block';
    }

    function resetForm() {
      document.getElementById('content').value = '';
      document.getElementById('charCount').textContent = '0 / ' + MAX_CHARS + ' 字符';
      document.getElementById('charCount').classList.remove('warning');
      document.getElementById('resultBox').style.display = 'none';
      document.getElementById('uploadForm').style.display = 'block';
    }

    function resetView() {
      document.getElementById('password').value = '';
      document.getElementById('viewResult').style.display = 'none';
      document.getElementById('viewForm').style.display = 'block';
    }

    // Show message
    function showMessage(text, type) {
      const msg = document.getElementById('message');
      msg.textContent = text;
      msg.className = 'message ' + type;
      msg.style.display = 'block';
      setTimeout(() => {
        msg.style.display = 'none';
      }, 3000);
    }

    // Escape HTML - used for user-generated error messages
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