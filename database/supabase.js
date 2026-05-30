/**
 * Supabase Client for Adriana Multi-Brand System
 * Primary database for calls, leads, SMS, and stats
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const REST_URL = `${SUPABASE_URL}/rest/v1`;

// This app only reads + writes calls/leads/sms for these brands. The DB is
// shared with the main Command Center; everything else is filtered out at
// the query layer so the dashboard only ever sees O1dMatch + Sevyn rows.
const APP_BRANDS = ['O1dMatch', 'Sevyn'];
const BRAND_FILTER = `brand=in.(${APP_BRANDS.map(encodeURIComponent).join(',')})`;

/**
 * Make authenticated request to Supabase
 */
async function supabaseRequest(table, method = 'GET', data = null, query = '') {
  const url = `${REST_URL}/${table}${query}`;
  
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    }
  };
  
  if (data && (method === 'POST' || method === 'PATCH')) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`Supabase ${method} ${table} failed:`, error);
      return null;
    }
    
    if (method === 'GET' || options.headers.Prefer === 'return=representation') {
      return await response.json();
    }
    
    return { success: true };
  } catch (error) {
    console.error(`Supabase error (${table}):`, error.message);
    return null;
  }
}

/**
 * Save a call record
 */
async function saveCall(callData) {
  // caller_phone is NOT NULL in the schema — use a placeholder if we can't
  // derive one so the row still saves and the transcript/summary land.
  const callerPhone = callData.caller_phone || 'unknown';
  const result = await supabaseRequest('calls', 'POST', {
    call_id: callData.call_id,
    brand: callData.brand || 'Unknown',
    caller_phone: callerPhone,
    caller_name: callData.caller_name || null,
    caller_email: callData.caller_email || null,
    caller_type: callData.caller_type || 'unknown',
    inquiry_topic: callData.inquiry_topic || null,
    outcome: callData.outcome || null,
    follow_up_needed: callData.follow_up_needed || false,
    call_duration_min: callData.call_duration_min || null,
    summary: callData.summary || null,
    transcript: callData.transcript || null,
    recording_url: callData.recording_url || null,
    timestamp: callData.timestamp || new Date().toISOString(),
    direction: callData.direction || 'inbound',
    metadata: callData.metadata || {}
  });

  if (result) {
    console.log(`✅ Call saved to Supabase: ${callData.call_id}`);
    return result[0] || result;
  }
  console.error(`❌ Call INSERT failed for ${callData.call_id} (brand=${callData.brand}, phone=${callerPhone})`);
  return null;
}

/**
 * Save a lead
 */
async function saveLead(leadData) {
  const result = await supabaseRequest('leads', 'POST', {
    call_id: leadData.call_id || null,
    name: leadData.name || null,
    phone: leadData.phone,
    email: leadData.email || null,
    brand: leadData.brand,
    source: leadData.source || 'voice',
    status: leadData.status || 'new',
    notes: leadData.notes || null
  });
  
  if (result) {
    console.log(`✅ Lead saved to Supabase`);
    return result[0] || result;
  }
  return null;
}

/**
 * Save SMS message
 */
async function saveSMS(smsData) {
  const result = await supabaseRequest('sms_messages', 'POST', {
    direction: smsData.direction,
    from_number: smsData.from,
    to_number: smsData.to,
    body: smsData.body,
    brand: smsData.brand || null,
    ai_response: smsData.ai_response || null,
    twilio_sid: smsData.twilio_sid || null
  });
  
  if (result) {
    console.log(`✅ SMS saved to Supabase`);
  }
  return result;
}

/**
 * Get recent calls
 */
async function getCalls(options = {}) {
  const { brand, limit = 50, followUpOnly = false } = options;

  let query = '?order=timestamp.desc';
  if (limit) query += `&limit=${limit}`;
  // Always scope to this app's brands; a caller-supplied brand narrows further
  // but can't escape the allowlist.
  if (brand && APP_BRANDS.includes(brand)) {
    query += `&brand=eq.${encodeURIComponent(brand)}`;
  } else {
    query += `&${BRAND_FILTER}`;
  }
  if (followUpOnly) query += `&follow_up_needed=eq.true`;

  const calls = await supabaseRequest('calls', 'GET', null, query);
  return calls || [];
}

/**
 * Get leads
 */
async function getLeads(options = {}) {
  const { brand, status, limit = 50 } = options;

  let query = '?order=created_at.desc';
  if (limit) query += `&limit=${limit}`;
  if (brand && APP_BRANDS.includes(brand)) {
    query += `&brand=eq.${encodeURIComponent(brand)}`;
  } else {
    query += `&${BRAND_FILTER}`;
  }
  if (status) query += `&status=eq.${status}`;

  const leads = await supabaseRequest('leads', 'GET', null, query);
  return leads || [];
}

/**
 * Get today's stats
 */
async function getStats() {
  const today = new Date().toISOString().split('T')[0];
  const stats = await supabaseRequest('stats', 'GET', null, `?date=eq.${today}`);
  
  if (stats && stats.length > 0) {
    return stats[0];
  }
  
  // Return default stats if none exist
  return {
    date: today,
    total_calls: 0,
    total_sms: 0,
    total_leads: 0,
    calls_by_brand: {}
  };
}

/**
 * Increment SMS count
 */
async function incrementSMSCount() {
  const today = new Date().toISOString().split('T')[0];
  
  // Try to update existing record
  const result = await supabaseRequest('stats', 'PATCH', {
    total_sms: 'total_sms + 1',
    updated_at: new Date().toISOString()
  }, `?date=eq.${today}`);
  
  // If no record exists, create one
  if (!result) {
    await supabaseRequest('stats', 'POST', {
      date: today,
      total_sms: 1
    });
  }
}

/**
 * Get SMS messages
 */
async function getSMS(options = {}) {
  const { limit = 50, direction } = options;

  let query = `?order=created_at.desc&${BRAND_FILTER}`;
  if (limit) query += `&limit=${limit}`;
  if (direction) query += `&direction=eq.${direction}`;

  const sms = await supabaseRequest('sms_messages', 'GET', null, query);
  return sms || [];
}

/**
 * Get call volume chart data (last 7 or 30 days)
 */
async function getChartData(days = 7) {
  const calls = await supabaseRequest('calls', 'GET', null, `?order=timestamp.desc&limit=500&${BRAND_FILTER}`);
  
  const now = new Date();
  const dayLabels = [];
  const dayCounts = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    dayLabels.push(dayName);
    
    const count = (calls || []).filter(c => 
      c.timestamp && c.timestamp.startsWith(dateStr)
    ).length;
    dayCounts.push(count);
  }
  
  return { labels: dayLabels, data: dayCounts };
}

/**
 * Update stats when a call is saved
 */
async function updateStatsForCall(brand) {
  const today = new Date().toISOString().split('T')[0];
  
  // Get current stats
  const stats = await supabaseRequest('stats', 'GET', null, `?date=eq.${today}`);
  
  if (stats && stats.length > 0) {
    // Update existing
    const current = stats[0];
    const byBrand = current.calls_by_brand || {};
    byBrand[brand] = (byBrand[brand] || 0) + 1;
    
    await supabaseRequest('stats', 'PATCH', {
      total_calls: (current.total_calls || 0) + 1,
      calls_by_brand: byBrand,
      updated_at: new Date().toISOString()
    }, `?date=eq.${today}`);
  } else {
    // Create new
    await supabaseRequest('stats', 'POST', {
      date: today,
      total_calls: 1,
      total_sms: 0,
      total_leads: 0,
      calls_by_brand: { [brand]: 1 }
    });
  }
}

/**
 * Get all data for dashboard
 */
async function getDashboardData() {
  const [calls, leads, stats, sms, chartResult] = await Promise.all([
    getCalls({ limit: 20 }),
    getLeads({ limit: 20 }),
    getStats(),
    getSMS({ limit: 20 }),
    getChartData(7)
  ]);
  
  // Also calculate today's stats from actual calls if stats table is empty
  const today = new Date().toISOString().split('T')[0];
  const todayCalls = (calls || []).filter(c => c.timestamp && c.timestamp.startsWith(today));
  const todaySMS = (sms || []).filter(s => s.created_at && s.created_at.startsWith(today));
  const todayLeads = (leads || []).filter(l => l.created_at && l.created_at.startsWith(today));
  
  // Always derive totals from the (already brand-filtered) lists rather
  // than the global stats table, since stats.total_calls aggregates
  // across all 6 brands in the shared DB.
  const filteredCallsByBrand = {};
  for (const b of APP_BRANDS) {
    filteredCallsByBrand[b] = todayCalls.filter(c => c.brand === b).length;
  }

  return {
    calls,
    leads,
    sms,
    stats: {
      total_calls: todayCalls.length,
      total_sms: todaySMS.length,
      total_leads: todayLeads.length,
      calls_by_brand: filteredCallsByBrand
    },
    chartData: chartResult.data,
    chartLabels: chartResult.labels,
    timestamp: new Date().toISOString()
  };
}

/**
 * Health check - verify Supabase connection
 */
async function healthCheck() {
  try {
    const result = await supabaseRequest('stats', 'GET', null, '?limit=1');
    return { ok: true, connected: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  saveCall,
  saveLead,
  saveSMS,
  getCalls,
  getLeads,
  getSMS,
  getStats,
  getDashboardData,
  getChartData,
  updateStatsForCall,
  incrementSMSCount,
  healthCheck,
  supabaseRequest
};
