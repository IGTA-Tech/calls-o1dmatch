/**
 * Security Middleware
 * 
 * Rate limiting, security headers, input validation
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Security Headers (via Helmet)
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://api.retellai.com",
        "wss://api.retellai.com",
        "https://api.vapi.ai",
        "wss://api.vapi.ai",
        // Twilio Voice SDK (WebRTC)
        "https://eventgw.twilio.com",
        "wss://eventgw.twilio.com",
        "https://chunderw-vpc-gll.twilio.com",
        "wss://chunderw-vpc-gll.twilio.com",
        "wss://*.twilio.com",
        "https://*.twilio.com"
      ],
      mediaSrc: ["'self'", "https://*.twilio.com", "https://*.vapi.ai", "https://storage.vapi.ai"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false
});

/**
 * Rate Limiters
 */

// General API rate limit: 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Login rate limit: 5 attempts per 15 minutes (stricter)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// SMS/Voice webhooks: Higher limit for Twilio callbacks
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // 200 per minute
  message: { error: 'Webhook rate limit exceeded.' }
});

/**
 * Input Sanitization
 */
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// Middleware to sanitize request body
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
};

/**
 * Request Logging (for security audit)
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')?.substring(0, 100)
    };
    
    // Log auth failures and errors
    if (res.statusCode >= 400) {
      console.log('⚠️ Request:', JSON.stringify(log));
    }
  });
  
  next();
};

/**
 * IP Whitelist for sensitive operations (optional)
 */
const WHITELISTED_IPS = [
  // Add trusted IPs here
  // '123.45.67.89'
];

const ipWhitelist = (req, res, next) => {
  if (WHITELISTED_IPS.length === 0) {
    return next(); // No whitelist = allow all
  }
  
  const clientIp = req.ip || req.connection.remoteAddress;
  if (WHITELISTED_IPS.includes(clientIp)) {
    return next();
  }
  
  console.log('🚫 Blocked IP:', clientIp);
  return res.status(403).json({ error: 'Access denied' });
};

/**
 * CORS Configuration
 */
const corsOptions = {
  origin: [
    'https://sevyn-sms-agent-production.up.railway.app',
    'http://localhost:3850',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

/**
 * Setup all security middleware
 */
function setupSecurity(app) {
  // Security headers
  app.use(securityHeaders);
  
  // Request logging
  app.use(requestLogger);
  
  // Sanitize input
  app.use(sanitizeBody);
  
  // Rate limiting for login
  app.use('/auth/login', loginLimiter);
  
  // Rate limiting for webhooks
  app.use('/sms', webhookLimiter);
  app.use('/voice', webhookLimiter);
  app.use('/voice-retell', webhookLimiter);
  app.use('/retell/webhook', webhookLimiter);
  app.use('/stripe/webhook', webhookLimiter);
  
  // General rate limiting for API
  app.use('/api/', generalLimiter);
  
  console.log('🔒 Security middleware initialized');
}

module.exports = {
  securityHeaders,
  generalLimiter,
  loginLimiter,
  webhookLimiter,
  sanitizeInput,
  sanitizeBody,
  requestLogger,
  ipWhitelist,
  corsOptions,
  setupSecurity
};
