// Cloudflare Worker - Secure Content Sharing System

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route handling
    if (path === '/' && request.method === 'GET') {
      return handleLoginPage();
    }

    if (path === '/api/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }

    if (path === '/api/admin/add' && request.method === 'POST') {
      return handleAdminAdd(request, env);
    }

    if (path === '/api/admin/delete' && request.method === 'POST') {
      return handleAdminDelete(request, env);
    }

    if (path === '/api/admin/list' && request.method === 'POST') {
      return handleAdminList(request, env);
    }

    if (path === '/admin' && request.method === 'GET') {
      return handleAdminPage();
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Utility: Hash password using SHA-256
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Escape HTML special characters to prevent XSS
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Utility: Escape JavaScript string literals
function escapeJsString(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "\\0");
}

// Utility: JSON response
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Utility: HTML response
function htmlResponse(html) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// API: Verify password and return content
async function handleVerify(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    const { password } = await request.json();

    if (!password) {
      return jsonResponse({ success: false, message: 'Password required' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const content = await env.CONTENT_KV.get(passwordHash);

    if (!content) {
      return jsonResponse({ success: false, message: 'Invalid password' }, 401);
    }

    const data = JSON.parse(content);

    // Check expiration
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      return jsonResponse({ success: false, message: 'Content expired' }, 401);
    }

    return jsonResponse({ success: true, data });
  } catch (error) {
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// API: Admin add content
async function handleAdminAdd(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    const { adminPassword, password, title, items, expiresAt } = await request.json();

    // Verify admin password
    if (adminPassword !== env.ADMIN_PASSWORD) {
      return jsonResponse({ success: false, message: 'Invalid admin password' }, 401);
    }

    if (!password || !title || !items || !Array.isArray(items)) {
      return jsonResponse({ success: false, message: 'Invalid data format' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const data = {
      title,
      items,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || null
    };

    await env.CONTENT_KV.put(passwordHash, JSON.stringify(data));

    return jsonResponse({ success: true, message: 'Content added successfully' });
  } catch (error) {
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// API: Admin delete content
async function handleAdminDelete(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    const { adminPassword, hash } = await request.json();

    if (adminPassword !== env.ADMIN_PASSWORD) {
      return jsonResponse({ success: false, message: 'Invalid admin password' }, 401);
    }

    if (!hash) {
      return jsonResponse({ success: false, message: 'Hash required' }, 400);
    }

    await env.CONTENT_KV.delete(hash);

    return jsonResponse({ success: true, message: 'Content deleted successfully' });
  } catch (error) {
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// API: Admin list all content
async function handleAdminList(request, env) {
  try {
    if (!env.CONTENT_KV) {
      return jsonResponse({ success: false, message: 'KV storage not configured' }, 500);
    }

    const { adminPassword } = await request.json();

    if (adminPassword !== env.ADMIN_PASSWORD) {
      return jsonResponse({ success: false, message: 'Invalid admin password' }, 401);
    }

    const list = await env.CONTENT_KV.list();
    const items = [];

    for (const key of list.keys) {
      const content = await env.CONTENT_KV.get(key.name);
      if (content) {
        const data = JSON.parse(content);
        items.push({
          hash: key.name,
          title: data.title,
          itemCount: data.items.length,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt
        });
      }
    }

    return jsonResponse({ success: true, items });
  } catch (error) {
    return jsonResponse({ success: false, message: 'Server error' }, 500);
  }
}

// Page: Login page
function handleLoginPage() {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secure Content</title>
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
      max-width: 400px;
    }

    h1 {
      text-align: center;
      color: #333;
      margin-bottom: 30px;
      font-size: 28px;
    }

    .input-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
    }

    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }

    input[type="password"]:focus {
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

    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
      text-align: center;
    }

    .admin-link {
      text-align: center;
      margin-top: 20px;
    }

    .admin-link a {
      color: #667eea;
      text-decoration: none;
      font-size: 14px;
    }

    .admin-link a:hover {
      text-decoration: underline;
    }

    @media (max-width: 768px) {
      .container {
        padding: 30px 20px;
      }

      h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Secure Content</h1>
    <div id="error" class="error"></div>
    <form id="loginForm">
      <div class="input-group">
        <label for="password">Enter Password</label>
        <input type="password" id="password" placeholder="Enter your password" required>
      </div>
      <button type="submit">Access Content</button>
    </form>
    <div class="admin-link">
      <a href="/admin">Admin Panel</a>
    </div>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;

      try {
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const result = await response.json();

        if (result.success) {
          showContent(result.data);
        } else {
          showError(result.message);
        }
      } catch (error) {
        showError('Network error');
      }
    });

    function showError(message) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      setTimeout(() => {
        errorDiv.style.display = 'none';
      }, 3000);
    }

    function showContent(data) {
      document.body.innerHTML = \`
        <div class="container" style="max-width: 800px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <h1 style="margin: 0;">\${escapeHtml(data.title)}</h1>
            <button onclick="location.reload()" style="width: auto; padding: 10px 20px; background: #6c757d;">Back</button>
          </div>
          <div class="content-grid">
            \${data.items.map((item, index) => \`
              <div class="content-card">
                <div class="card-label">\${escapeHtml(item.label)}</div>
                <div class="card-content">\${escapeHtml(item.content)}</div>
                <button class="copy-btn" data-content="\${escapeHtml(item.content)}">Copy</button>
              </div>
            \`).join('')}
          </div>
        </div>
        <style>
          .content-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
          }

          .content-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            border: 2px solid #e0e0e0;
            transition: transform 0.2s, box-shadow 0.2s;
          }

          .content-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
          }

          .card-label {
            font-weight: 600;
            color: #667eea;
            margin-bottom: 10px;
            font-size: 14px;
            text-transform: uppercase;
          }

          .card-content {
            color: #333;
            margin-bottom: 15px;
            word-break: break-all;
            font-family: monospace;
            background: white;
            padding: 12px;
            border-radius: 6px;
            font-size: 14px;
          }

          .copy-btn {
            width: 100%;
            padding: 10px;
            background: #28a745;
            font-size: 14px;
          }

          .copy-btn:hover {
            background: #218838;
          }

          .copy-btn.copied {
            background: #6c757d;
          }

          @media (max-width: 768px) {
            .content-grid {
              grid-template-columns: 1fr;
            }
          }
        </style>
      \`;
    }

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('copy-btn')) {
        const text = e.target.getAttribute('data-content');
        navigator.clipboard.writeText(text).then(() => {
          const originalText = e.target.textContent;
          e.target.textContent = 'Copied!';
          e.target.classList.add('copied');
          setTimeout(() => {
            e.target.textContent = originalText;
            e.target.classList.remove('copied');
          }, 2000);
        });
      }
    });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function escapeJsString(str) {
      return str
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
    }
  </script>
</body>
</html>
  `;
  return htmlResponse(html);
}

// Page: Admin page
function handleAdminPage() {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel</title>
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
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      padding: 40px;
      max-width: 900px;
      margin: 0 auto;
    }

    h1 {
      color: #333;
      margin-bottom: 30px;
      text-align: center;
    }

    .section {
      margin-bottom: 40px;
    }

    .section h2 {
      color: #667eea;
      margin-bottom: 20px;
      font-size: 20px;
    }

    .form-group {
      margin-bottom: 15px;
    }

    label {
      display: block;
      margin-bottom: 5px;
      color: #555;
      font-weight: 500;
    }

    input, textarea {
      width: 100%;
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
    }

    textarea {
      min-height: 100px;
      font-family: monospace;
    }

    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
    }

    .message {
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      display: none;
    }

    .message.success {
      background: #d4edda;
      color: #155724;
    }

    .message.error {
      background: #f8d7da;
      color: #721c24;
    }

    .item-input {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 10px;
    }

    .add-item-btn {
      background: #28a745;
      margin-top: 10px;
    }

    .back-link {
      text-align: center;
      margin-top: 20px;
    }

    .back-link a {
      color: #667eea;
      text-decoration: none;
    }

    #contentList {
      margin-top: 20px;
    }

    .content-item {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .delete-btn {
      background: #dc3545;
      padding: 8px 16px;
    }

    @media (max-width: 768px) {
      .container {
        padding: 20px;
      }

      .content-item {
        flex-direction: column;
        align-items: flex-start;
      }

      .delete-btn {
        margin-top: 10px;
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔧 Admin Panel</h1>

    <div id="message" class="message"></div>

    <div class="section">
      <h2>Add New Content</h2>
      <form id="addForm">
        <div class="form-group">
          <label>Admin Password</label>
          <input type="password" id="adminPassword" required>
        </div>
        <div class="form-group">
          <label>User Password</label>
          <input type="password" id="userPassword" required>
        </div>
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="title" required>
        </div>
        <div class="form-group">
          <label>Content Items</label>
          <div id="itemsContainer">
            <div class="item-input">
              <input type="text" placeholder="Label" class="item-label" required>
              <textarea placeholder="Content" class="item-content" required></textarea>
            </div>
          </div>
          <button type="button" class="add-item-btn" onclick="addItemInput()">+ Add Item</button>
        </div>
        <button type="submit">Add Content</button>
      </form>
    </div>

    <div class="section">
      <h2>Manage Content</h2>
      <button onclick="loadContentList()">Load Content List</button>
      <div id="contentList"></div>
    </div>

    <div class="back-link">
      <a href="/">← Back to Login</a>
    </div>
  </div>

  <script>
    let adminPasswordCache = '';

    function showMessage(text, type) {
      const msg = document.getElementById('message');
      msg.textContent = text;
      msg.className = 'message ' + type;
      msg.style.display = 'block';
      setTimeout(() => {
        msg.style.display = 'none';
      }, 3000);
    }

    function addItemInput() {
      const container = document.getElementById('itemsContainer');
      const div = document.createElement('div');
      div.className = 'item-input';
      div.innerHTML = \`
        <input type="text" placeholder="Label" class="item-label" required>
        <textarea placeholder="Content" class="item-content" required></textarea>
      \`;
      container.appendChild(div);
    }

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const adminPassword = document.getElementById('adminPassword').value;
      const userPassword = document.getElementById('userPassword').value;
      const title = document.getElementById('title').value;

      const itemInputs = document.querySelectorAll('.item-input');
      const items = [];
      itemInputs.forEach(input => {
        const label = input.querySelector('.item-label').value;
        const content = input.querySelector('.item-content').value;
        if (label && content) {
          items.push({ label, content });
        }
      });

      try {
        const response = await fetch('/api/admin/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword, password: userPassword, title, items })
        });

        const result = await response.json();

        if (result.success) {
          showMessage('Content added successfully', 'success');
          adminPasswordCache = adminPassword;
          document.getElementById('addForm').reset();
          document.getElementById('itemsContainer').innerHTML = \`
            <div class="item-input">
              <input type="text" placeholder="Label" class="item-label" required>
              <textarea placeholder="Content" class="item-content" required></textarea>
            </div>
          \`;
        } else {
          showMessage(result.message, 'error');
        }
      } catch (error) {
        showMessage('Network error', 'error');
      }
    });

    async function loadContentList() {
      const adminPassword = document.getElementById('adminPassword').value || adminPasswordCache;

      if (!adminPassword) {
        showMessage('Please enter admin password first', 'error');
        return;
      }

      try {
        const response = await fetch('/api/admin/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword })
        });

        const result = await response.json();

        if (result.success) {
          adminPasswordCache = adminPassword;
          const listDiv = document.getElementById('contentList');
          if (result.items.length === 0) {
            listDiv.innerHTML = '<p>No content found</p>';
          } else {
            listDiv.innerHTML = result.items.map(item => \`
              <div class="content-item">
                <div>
                  <strong>\${item.title}</strong><br>
                  <small>Items: \${item.itemCount} | Created: \${new Date(item.createdAt).toLocaleString()}</small>
                </div>
                <button class="delete-btn" onclick="deleteContent('\${item.hash}')">Delete</button>
              </div>
            \`).join('');
          }
        } else {
          showMessage(result.message, 'error');
        }
      } catch (error) {
        showMessage('Network error', 'error');
      }
    }

    async function deleteContent(hash) {
      if (!confirm('Are you sure you want to delete this content?')) {
        return;
      }

      const adminPassword = document.getElementById('adminPassword').value || adminPasswordCache;

      try {
        const response = await fetch('/api/admin/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword, hash })
        });

        const result = await response.json();

        if (result.success) {
          showMessage('Content deleted successfully', 'success');
          loadContentList();
        } else {
          showMessage(result.message, 'error');
        }
      } catch (error) {
        showMessage('Network error', 'error');
      }
    }
  </script>
</body>
</html>
  `;
  return htmlResponse(html);
}
