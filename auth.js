/**
 * Authentication & Security Module
 * 
 * Dashboard login, JWT sessions, rate limiting
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// JWT Secret (use env var in production)
const JWT_SECRET = process.env.JWT_SECRET || 'adriana-dashboard-secret-change-in-production';
const JWT_EXPIRY = '24h';

// Dashboard Users (in production, store in database)
// Password hash generated with: bcrypt.hashSync('password', 10)
const USERS = {
  'admin': {
    passwordHash: bcrypt.hashSync('Adriana2026!', 10),
    role: 'admin',
    name: 'Administrator'
  },
  'sherrod': {
    passwordHash: bcrypt.hashSync('SherrodSSV2026!', 10),
    role: 'admin',
    name: 'Sherrod Seward'
  },
  'gabby': {
    passwordHash: bcrypt.hashSync('GabbyTeam2026!', 10),
    role: 'staff',
    name: 'Gabby Terico'
  },
  'yusuf': {
    passwordHash: bcrypt.hashSync('YusufDev2026!', 10),
    role: 'admin',
    name: 'Yusuf Awodire'
  }
};

/**
 * Verify login credentials
 */
function verifyCredentials(username, password) {
  const user = USERS[username.toLowerCase()];
  if (!user) return null;
  
  if (bcrypt.compareSync(password, user.passwordHash)) {
    return {
      username: username.toLowerCase(),
      role: user.role,
      name: user.name
    };
  }
  return null;
}

/**
 * Generate JWT token
 */
function generateToken(user) {
  return jwt.sign(
    { 
      username: user.username,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Auth Middleware - Protect routes
 */
function requireAuth(req, res, next) {
  // Check for token in cookie or Authorization header
  let token = req.cookies?.authToken;
  
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }
  
  if (!token) {
    // For browser requests, redirect to login
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const user = verifyToken(token);
  if (!user) {
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.user = user;
  next();
}

/**
 * Admin-only middleware
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Login page HTML
 */
const loginPageHTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Adriana Dashboard - Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      background: #fff;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 400px;
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo h1 {
      color: #1a1a2e;
      font-size: 28px;
      margin-bottom: 5px;
    }
    .logo p {
      color: #666;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-weight: 500;
    }
    input {
      width: 100%;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #4a6cf7;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #4a6cf7 0%, #6a5acd 100%);
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
      box-shadow: 0 5px 20px rgba(74, 108, 247, 0.4);
    }
    .error {
      background: #ffe6e6;
      color: #cc0000;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
      display: none;
    }
    .brands {
      margin-top: 30px;
      text-align: center;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <h1>📞 Adriana</h1>
      <p>Multi-Brand Command Center</p>
    </div>
    
    <div class="error" id="error"></div>
    
    <form id="loginForm">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      
      <button type="submit">Sign In</button>
    </form>
    
    <div class="brands">
      SSV • Aventus • O1dMatch • IGTA • DC Federal • Sevyn
    </div>
  </div>
  
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error');
      
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.style.display = 'block';
        }
      } catch (err) {
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
      }
    });
  </script>
</body>
</html>
`;

/**
 * Setup auth routes
 */
function setupAuthRoutes(app) {
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());
  
  // Login page
  app.get('/login', (req, res) => {
    res.send(loginPageHTML);
  });
  
  // Login API
  app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    const user = verifyCredentials(username, password);
    
    if (user) {
      const token = generateToken(user);
      
      // Set HTTP-only cookie
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      console.log('✅ Login successful:', username);
      res.json({ success: true, user: { username: user.username, name: user.name, role: user.role } });
    } else {
      console.log('❌ Login failed:', username);
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  });
  
  // Logout
  app.get('/auth/logout', (req, res) => {
    res.clearCookie('authToken');
    res.redirect('/login');
  });
  
  app.post('/auth/logout', (req, res) => {
    res.clearCookie('authToken');
    res.json({ success: true });
  });
  
  // Check auth status
  app.get('/auth/status', (req, res) => {
    const token = req.cookies?.authToken;
    if (token) {
      const user = verifyToken(token);
      if (user) {
        return res.json({ authenticated: true, user });
      }
    }
    res.json({ authenticated: false });
  });
}

module.exports = {
  verifyCredentials,
  generateToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  setupAuthRoutes,
  USERS
};
