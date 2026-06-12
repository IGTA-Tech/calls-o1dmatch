/**
 * Supabase Authentication Module
 *
 * Features:
 * - Sign up / Login with email & password
 * - Admin approval workflow (new users are "pending")
 * - Role-based access: admin, approved, pending
 * - First user becomes admin automatically
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;                    // anon — for auth flows
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY     // service_role — bypasses RLS
  || process.env.SUPABASE_KEY;                                    // fallback to anon if unset (legacy)

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_KEY not set — dbClient falling back to anon key. RLS will block dashboard_users queries.');
}

// Auth client — anon key. Used ONLY for auth operations (signIn, signUp, getUser).
// Anon key is required here because the auth flow needs to issue/refresh
// user-scoped JWTs and Supabase Auth treats the anon key as the public entry.
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// DB client — service_role key. Bypasses RLS so we can always read/write
// dashboard_users without recursive policy loops. NEVER expose this client
// or its key to the browser.
const dbClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Sign up a new user
 */
async function signUp(email, password, name) {
  try {
    const { data: authData, error: authError } = await authClient.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });

    if (authError) {
      console.error('Auth signup error:', authError.message);
      return { success: false, error: authError.message };
    }

    // Check if this is the first user (becomes admin) - use dbClient to bypass RLS
    const { count, error: countError } = await dbClient
      .from('dashboard_users')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Count query error:', countError.message);
    }

    const isFirstUser = !countError && (count === 0 || count === null);
    const role = isFirstUser ? 'admin' : 'pending';

    // Create dashboard user record - use dbClient to bypass RLS
    const { error: dbError } = await dbClient
      .from('dashboard_users')
      .insert({
        auth_id: authData.user?.id,
        email,
        name,
        role,
        approved_at: isFirstUser ? new Date().toISOString() : null
      });

    if (dbError) {
      console.error('DB insert error:', dbError.message);
    }

    console.log(`✅ User signed up: ${email} (role: ${role})`);

    return {
      success: true,
      user: authData.user,
      session: authData.session || null,
      role,
      message: isFirstUser
        ? 'Account created! You are the first admin.'
        : 'Account created! Please wait for admin approval.'
    };
  } catch (err) {
    console.error('Signup error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Login user
 */
async function login(email, password) {
  try {
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Login error:', error.message);
      return { success: false, error: error.message };
    }

    // Check user role - use dbClient (service_role) to ALWAYS bypass RLS
    const { data: userData, error: userError } = await dbClient
      .from('dashboard_users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError) {
      console.error('Dashboard user query error:', userError.message);
    }

    if (userError || !userData) {
      // User in auth but not in dashboard_users - add as pending
      await dbClient.from('dashboard_users').insert({
        auth_id: data.user.id,
        email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        role: 'pending'
      });

      return {
        success: false,
        error: 'Your account is pending approval. Please contact an admin.'
      };
    }

    if (userData.role === 'pending') {
      return {
        success: false,
        error: 'Your account is pending approval. Please contact an admin.'
      };
    }

    if (userData.role === 'rejected') {
      return {
        success: false,
        error: 'Your account access has been denied.'
      };
    }

    console.log(`✅ Login successful: ${email} (role: ${userData.role})`);

    return {
      success: true,
      session: data.session,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        role: userData.role
      }
    };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Logout user
 */
async function logout() {
  const { error } = await authClient.auth.signOut();
  return { success: !error, error: error?.message };
}

/**
 * Get current session
 */
async function getSession(accessToken) {
  try {
    const { data: { user }, error } = await authClient.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    // Use dbClient to bypass RLS
    const { data: userData } = await dbClient
      .from('dashboard_users')
      .select('*')
      .eq('email', user.email)
      .single();

    if (!userData || !['admin', 'approved'].includes(userData.role)) {
      return null;
    }

    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role
    };
  } catch (err) {
    console.error('Session error:', err);
    return null;
  }
}

/**
 * List pending users (admin only)
 */
async function listPendingUsers() {
  const { data, error } = await dbClient
    .from('dashboard_users')
    .select('*')
    .eq('role', 'pending')
    .order('created_at', { ascending: false });

  return { users: data || [], error: error?.message };
}

/**
 * List all users (admin only)
 */
async function listAllUsers() {
  const { data, error } = await dbClient
    .from('dashboard_users')
    .select('*')
    .order('created_at', { ascending: false });

  return { users: data || [], error: error?.message };
}

/**
 * Approve user (admin only)
 */
async function approveUser(userId, adminId) {
  console.log(`Approving user: ${userId} by admin: ${adminId}`);

  // First try full update with all fields
  let { error } = await dbClient
    .from('dashboard_users')
    .update({
      role: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminId
    })
    .eq('id', userId);

  // If that fails (e.g. missing columns), fall back to just updating role
  if (error) {
    console.warn('Full approve update failed, trying role-only:', error.message);
    const retry = await dbClient
      .from('dashboard_users')
      .update({ role: 'approved' })
      .eq('id', userId);
    error = retry.error;
  }

  if (error) {
    console.error('Approve failed:', error.message);
  } else {
    console.log(`✅ User approved: ${userId} by ${adminId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Reject user (admin only)
 */
async function rejectUser(userId) {
  console.log(`Rejecting user: ${userId}`);
  const { error } = await dbClient
    .from('dashboard_users')
    .update({ role: 'rejected' })
    .eq('id', userId);

  if (error) {
    console.error('Reject failed:', error.message);
  } else {
    console.log(`✅ User rejected: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Make user admin (admin only)
 */
async function makeAdmin(userId, adminId) {
  console.log(`Making admin: ${userId} by admin: ${adminId}`);

  let { error } = await dbClient
    .from('dashboard_users')
    .update({
      role: 'admin',
      approved_at: new Date().toISOString(),
      approved_by: adminId
    })
    .eq('id', userId);

  if (error) {
    console.warn('Full make-admin update failed, trying role-only:', error.message);
    const retry = await dbClient
      .from('dashboard_users')
      .update({ role: 'admin' })
      .eq('id', userId);
    error = retry.error;
  }

  if (error) {
    console.error('Make admin failed:', error.message);
  } else {
    console.log(`✅ User promoted to admin: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Demote admin back to approved user
 */
async function demoteAdmin(userId, adminId) {
  // Prevent self-demotion
  if (userId === adminId) {
    return { success: false, error: 'Cannot demote yourself' };
  }

  console.log(`Demoting admin: ${userId} by admin: ${adminId}`);

  const { error } = await dbClient
    .from('dashboard_users')
    .update({ role: 'approved' })
    .eq('id', userId)
    .eq('role', 'admin');

  if (error) {
    console.error('Demote admin failed:', error.message);
  } else {
    console.log(`✅ Admin demoted to approved: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Auth middleware for protected routes
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.access_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  getSession(token).then(user => {
    if (!user) {
      if (req.accepts('html')) {
        return res.redirect('/login');
      }
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = user;
    next();
  }).catch(err => {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication error' });
  });
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
 * Check dashboard_users table exists on startup
 */
async function checkAuthTable() {
  try {
    const { data, error } = await dbClient
      .from('dashboard_users')
      .select('id', { count: 'exact', head: true });

    if (error && error.message.includes('does not exist')) {
      console.error(`
⚠️  dashboard_users table does not exist!

Go to your Supabase Dashboard → SQL Editor and run:

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'pending' CHECK (role IN ('admin', 'approved', 'pending', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON dashboard_users(email);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users(role);
      `);
      return false;
    }

    console.log('✅ dashboard_users table verified');
    return true;
  } catch (err) {
    console.error('Auth table check failed:', err.message);
    return false;
  }
}

/**
 * Login page - served from public/login.html
 */
const path = require('path');
const loginPagePath = path.join(__dirname, 'public', 'login.html');

/**
 * Setup auth routes
 */
function setupAuthRoutes(app) {
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  // Verify table exists on startup
  checkAuthTable();

  // Login page
  app.get('/login', (req, res) => {
    res.sendFile(loginPagePath);
  });

  // Signup API
  app.post('/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await signUp(email, password, name || email.split('@')[0]);

    // Auto-login first admin user
    if (result.success && result.role === 'admin' && result.session) {
      res.cookie('access_token', result.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.json(result);
  });

  // Login API
  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await login(email, password);

    if (result.success && result.session) {
      res.cookie('access_token', result.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.json(result);
  });

  // Logout
  app.get('/auth/logout', async (req, res) => {
    await logout();
    res.clearCookie('access_token');
    res.redirect('/login');
  });

  // Check auth status
  app.get('/auth/status', async (req, res) => {
    const token = req.cookies?.access_token;
    if (token) {
      const user = await getSession(token);
      if (user) {
        return res.json({ authenticated: true, user });
      }
    }
    res.json({ authenticated: false });
  });

  // Admin: List pending users
  app.get('/api/admin/pending', requireAuth, requireAdmin, async (req, res) => {
    const result = await listPendingUsers();
    res.json(result);
  });

  // Admin: List all users
  app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await listAllUsers();
    res.json(result);
  });

  // Admin: Approve user
  app.post('/api/admin/approve', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await approveUser(userId, req.user.id);
    res.json(result);
  });

  // Admin: Reject user
  app.post('/api/admin/reject', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await rejectUser(userId);
    res.json(result);
  });

  // Admin: Make admin
  app.post('/api/admin/make-admin', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await makeAdmin(userId, req.user.id);
    res.json(result);
  });

  // Admin: Demote admin back to approved
  app.post('/api/admin/demote', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await demoteAdmin(userId, req.user.id);
    res.json(result);
  });
}

module.exports = {
  supabase: dbClient,
  signUp,
  login,
  logout,
  getSession,
  listPendingUsers,
  listAllUsers,
  approveUser,
  rejectUser,
  makeAdmin,
  demoteAdmin,
  requireAuth,
  requireAdmin,
  setupAuthRoutes
};
