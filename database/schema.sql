-- Supabase Schema for Adriana Multi-Brand Calling System
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/nraxsxvjjffgrmfukjqf/sql

-- Calls table - stores all call data
CREATE TABLE IF NOT EXISTS calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id TEXT UNIQUE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  brand TEXT NOT NULL,
  caller_phone TEXT NOT NULL,
  caller_name TEXT,
  caller_email TEXT,
  caller_type TEXT DEFAULT 'unknown',
  inquiry_topic TEXT,
  outcome TEXT,
  follow_up_needed BOOLEAN DEFAULT FALSE,
  call_duration_min NUMERIC,
  summary TEXT,
  transcript TEXT,
  recording_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads table - qualified leads from calls
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id TEXT REFERENCES calls(call_id),
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  brand TEXT NOT NULL,
  source TEXT DEFAULT 'voice',
  status TEXT DEFAULT 'new',
  notes TEXT,
  follow_up_date DATE,
  assigned_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS messages table
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  direction TEXT NOT NULL, -- 'inbound' or 'outbound'
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  brand TEXT,
  ai_response TEXT,
  twilio_sid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stats table - aggregated statistics
CREATE TABLE IF NOT EXISTS stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE UNIQUE,
  total_calls INTEGER DEFAULT 0,
  total_sms INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  calls_by_brand JSONB DEFAULT '{}',
  sms_by_brand JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_brand ON calls(brand);
CREATE INDEX IF NOT EXISTS idx_calls_timestamp ON calls(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_calls_follow_up ON calls(follow_up_needed) WHERE follow_up_needed = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_brand ON leads(brand);
CREATE INDEX IF NOT EXISTS idx_sms_created ON sms_messages(created_at DESC);

-- Enable Row Level Security (optional, for production)
-- ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE stats ENABLE ROW LEVEL SECURITY;

-- Create a function to update stats
CREATE OR REPLACE FUNCTION update_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stats (date, total_calls, calls_by_brand)
  VALUES (CURRENT_DATE, 1, jsonb_build_object(NEW.brand, 1))
  ON CONFLICT (date) DO UPDATE SET
    total_calls = stats.total_calls + 1,
    calls_by_brand = stats.calls_by_brand || jsonb_build_object(
      NEW.brand, 
      COALESCE((stats.calls_by_brand->>NEW.brand)::int, 0) + 1
    ),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update stats on new calls
DROP TRIGGER IF EXISTS trigger_update_stats ON calls;
CREATE TRIGGER trigger_update_stats
AFTER INSERT ON calls
FOR EACH ROW EXECUTE FUNCTION update_daily_stats();
