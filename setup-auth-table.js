/**
 * Setup dashboard_users table in Supabase
 * Run once: node setup-auth-table.js
 */

const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.log(`
⚠️  SUPABASE_SERVICE_KEY not set!

To set up the dashboard_users table, you need to:

1. Go to Supabase Dashboard → SQL Editor
2. Run this SQL:

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'pending' CHECK (role IN ('admin', 'approved', 'pending', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES dashboard_users(id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON dashboard_users(email);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users(role);

-- Enable RLS
ALTER TABLE dashboard_users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own record
CREATE POLICY "Users can read own record" ON dashboard_users
  FOR SELECT USING (auth.email() = email);

-- Policy: Admins can read all
CREATE POLICY "Admins can read all" ON dashboard_users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM dashboard_users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Policy: Admins can update
CREATE POLICY "Admins can update" ON dashboard_users
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM dashboard_users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Policy: Anyone can insert (for signup)
CREATE POLICY "Anyone can insert" ON dashboard_users
  FOR INSERT WITH CHECK (true);
  `);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function setup() {
  console.log('Setting up dashboard_users table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
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
    `
  });
  
  if (error) {
    console.error('Error:', error.message);
    console.log('\nPlease run the SQL manually in Supabase Dashboard.');
  } else {
    console.log('✅ Table created successfully!');
  }
}

setup();
