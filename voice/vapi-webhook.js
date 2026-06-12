/**
 * Vapi Webhook Handler
 * Receives call events from Vapi and logs to Supabase + Google Sheets.
 * Mirrors retell-webhook.js so the rest of the app sees the same call records
 * regardless of which voice provider is active.
 *
 * Vapi sends events wrapped as { message: { type, call, ...payload } }.
 * The relevant types are: status-update, end-of-call-report, transcript,
 * function-call, hang. We only persist on status-update (in-progress / ended)
 * and end-of-call-report (final analysis).
 */

const { saveCall, updateStatsForCall, supabaseRequest } = require('../database/supabase');
const { writeLeadToSheet, writeCallLog } = require('../database/sheets');
const { sendFollowupSMS } = require('../sms/followup');
const { sendCallSummary } = require('../email/call-summary');
const { getBrandConfig, BRAND_CONFIGS } = require('./vapi-client');

// Blocked caller list, backed by Supabase table `blocked_numbers`. Cached in
// memory for 30s so we don't hammer the DB on every inbound call. Checked on
// Vapi's `assistant-request` event so the call is rejected BEFORE Vapi
// connects audio — no call record, no log, no email.
const BLOCK_CACHE_TTL_MS = 30 * 1000;
let _blockCache = { numbers: new Set(), expiresAt: 0 };
async function getBlockedNumbers() {
  if (Date.now() < _blockCache.expiresAt) return _blockCache.numbers;
  try {
    const rows = await supabaseRequest('blocked_numbers', 'GET', null, '?select=phone');
    const numbers = new Set((rows || []).map(r => r.phone));
    _blockCache = { numbers, expiresAt: Date.now() + BLOCK_CACHE_TTL_MS };
    return numbers;
  } catch (err) {
    console.error('   ⚠️ Could not load blocked_numbers from Supabase:', err.message);
    return _blockCache.numbers;
  }
}
function invalidateBlockCache() { _blockCache.expiresAt = 0; }

// Static phone → assistantId map for `assistant-request` routing. Env-var
// based so it survives Vapi dashboard changes that clear the static
// assistantId from the phone-number resource. Falls back to a dynamic Vapi
// API lookup if env vars are unset.
const STATIC_PHONE_TO_ASSISTANT = {
  '+15617944621': process.env.VAPI_ASSISTANT_O1DMATCH,
  '+19803032854': process.env.VAPI_ASSISTANT_SEVYN
};

let _phoneToAssistantDynamic = null;
async function getDynamicPhoneToAssistantMap() {
  if (_phoneToAssistantDynamic) return _phoneToAssistantDynamic;
  _phoneToAssistantDynamic = {};
  try {
    const res = await fetch('https://api.vapi.ai/phone-number', {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` }
    });
    const numbers = await res.json();
    for (const p of numbers || []) {
      if (p.number && p.assistantId) _phoneToAssistantDynamic[p.number] = p.assistantId;
    }
    console.log(`   🗺️  Built phone→assistant map (${Object.keys(_phoneToAssistantDynamic).length} entries)`);
  } catch (err) {
    console.error('   ⚠️ Could not build phone→assistant map:', err.message);
  }
  return _phoneToAssistantDynamic;
}

async function lookupAssistantIdForPhone(phone) {
  if (!phone) return null;
  if (STATIC_PHONE_TO_ASSISTANT[phone]) return STATIC_PHONE_TO_ASSISTANT[phone];
  const dyn = await getDynamicPhoneToAssistantMap();
  return dyn[phone] || null;
}

// assistantId -> brand phone. Built once on first webhook by querying Vapi.
// Vapi always sends assistantId but may omit phoneNumber on some events, so
// this is our reliable brand lookup.
let _assistantBrandPhone = null;
async function getAssistantBrandPhone() {
  if (_assistantBrandPhone) return _assistantBrandPhone;
  _assistantBrandPhone = {};
  try {
    const res = await fetch('https://api.vapi.ai/phone-number', {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` }
    });
    const numbers = await res.json();
    for (const p of numbers || []) {
      if (p.assistantId && p.number) _assistantBrandPhone[p.assistantId] = p.number;
    }
    console.log(`   🗺️  Built assistant→brand map (${Object.keys(_assistantBrandPhone).length} entries)`);
  } catch (err) {
    console.error('   ⚠️ Could not build assistant→brand map:', err.message);
  }
  return _assistantBrandPhone;
}

async function resolveBrand(call) {
  // Try direct phone first (most reliable when present)
  const brandPhone = call?.phoneNumber?.number;
  if (brandPhone) {
    const c = getBrandConfig(brandPhone);
    if (c && c.brand && c.brand !== 'General') return c;
  }
  // Fall back to assistantId lookup
  if (call?.assistantId) {
    const map = await getAssistantBrandPhone();
    const phone = map[call.assistantId];
    if (phone) {
      const c = getBrandConfig(phone);
      if (c) return c;
    }
  }
  // Last resort: customer number (rarely useful — only matches if customer dialed our number)
  return getBrandConfig(call?.customer?.number);
}

function deriveDirection(call) {
  if (call?.type?.toLowerCase().includes('outbound')) return 'outbound';
  if (call?.type?.toLowerCase().includes('inbound')) return 'inbound';
  return BRAND_CONFIGS[call?.phoneNumber?.number] && call?.customer?.number ? 'outbound' : 'inbound';
}

async function handleVapiWebhook(req, res) {
  const message = req.body.message || req.body;
  const type = message.type;

  console.log(`\n📞 Vapi Event: ${type} (call=${message.call?.id})`);

  // `assistant-request` fires before the call connects. Vapi waits for OUR
  // response to decide which assistant to use — or whether to hang up.
  // Must respond synchronously with { assistantId } or { error }.
  if (type === 'assistant-request') {
    return await handleAssistantRequest(message, res);
  }

  // Respond to Vapi IMMEDIATELY — their webhook delivery times out around 30s,
  // and end-of-call-report does Sheets + Email + Supabase work that can take
  // longer. Process the work asynchronously so we never get cut off mid-write.
  res.json({ received: true });

  // Now do the heavy work without blocking the response.
  (async () => {
    try {
      switch (type) {
        case 'status-update':
          if (message.status === 'ended') {
            await handleCallEnded(message);
          } else if (message.status === 'in-progress') {
            console.log(`   Call started: ${message.call?.id}`);
          }
          break;

        case 'end-of-call-report':
          await handleEndOfCallReport(message);
          break;

        case 'function-call':
        case 'transcript':
        case 'hang':
          break;

        default:
          console.log(`   Unhandled Vapi event: ${type}`);
      }
    } catch (err) {
      console.error(`   ❌ Vapi webhook error (async):`, err.stack || err.message);
    }
  })();
}

async function handleAssistantRequest(message, res) {
  const call = message.call || {};
  const callerNumber = call.customer?.number || null;
  const brandPhone = call.phoneNumber?.number || null;

  console.log(`   📞 assistant-request: caller=${callerNumber} → brand=${brandPhone}`);

  const blocked = await getBlockedNumbers();
  if (callerNumber && blocked.has(callerNumber)) {
    console.log(`   🚫 BLOCKED caller ${callerNumber} — refusing call`);
    return res.json({ error: 'This number is not authorized to call.' });
  }

  const assistantId = await lookupAssistantIdForPhone(brandPhone);
  if (!assistantId) {
    console.error(`   ❌ No assistantId resolved for brand phone ${brandPhone} — set VAPI_ASSISTANT_<BRAND> env var`);
    return res.json({ error: 'Call could not be routed. Please try again later.' });
  }

  console.log(`   ✅ Routing ${brandPhone} → assistant ${assistantId}`);
  return res.json({ assistantId });
}

async function handleCallEnded(message) {
  const call = message.call || {};
  const direction = deriveDirection(call);
  const brand = await resolveBrand(call);

  const fromNumber = call.phoneNumber?.number || brand.phone || null;
  const toNumber = call.customer?.number || null;
  const callerPhone = direction === 'outbound' ? toNumber : fromNumber === brand.phone ? toNumber : fromNumber;

  const startedAt = call.startedAt || message.timestamp || new Date().toISOString();
  const endedAt = call.endedAt || new Date().toISOString();
  const durationMs = call.startedAt && call.endedAt
    ? new Date(call.endedAt) - new Date(call.startedAt)
    : null;

  console.log(`   Call ended: ${call.id}`);
  console.log(`   Brand: ${brand.brand} (${direction}, from=${fromNumber}, to=${toNumber}, caller=${callerPhone})`);
  console.log(`   Duration: ${durationMs ? Math.round(durationMs / 60000) : 0} min`);

  const callData = {
    call_id: call.id,
    brand: brand.brand,
    caller_phone: callerPhone,
    caller_name: null,
    caller_email: null,
    caller_type: 'unknown',
    inquiry_topic: null,
    outcome: call.endedReason || 'completed',
    follow_up_needed: false,
    call_duration_min: durationMs ? Math.round(durationMs / 60000) : null,
    summary: null,
    transcript: null,
    recording_url: null,
    timestamp: startedAt,
    direction,
    metadata: {
      vapi_call_id: call.id,
      assistant_id: call.assistantId,
      end_reason: call.endedReason,
      provider: 'vapi',
      direction
    }
  };

  await saveCall(callData);
  await updateStatsForCall(brand.brand);

  // Sheets write is deferred to end-of-call-report (which has caller_name,
  // topic, summary, etc.). Writing here would create rows with empty Summary
  // and no Update path to fill them in later.
}

async function handleEndOfCallReport(message, opts = {}) {
  const call = message.call || {};
  const analysis = message.analysis || {};
  const structured = analysis.structuredData || {};
  const artifact = message.artifact || {};

  const direction = deriveDirection(call);
  const brand = await resolveBrand(call);

  const rawTranscript = artifact.transcript || call.transcript || message.transcript || null;
  const transcript = rawTranscript
    ? rawTranscript.replace(/^AI:/gm, 'Agent:').replace(/\nAI:/g, '\nAgent:')
    : null;
  const recordingUrl = artifact.recordingUrl || artifact.stereoRecordingUrl || call.recordingUrl || null;

  console.log(`   End-of-call report: ${call.id}`);
  console.log(`   Brand: ${brand.brand} (${direction})`);
  console.log(`   Caller Name: ${structured.caller_name || 'N/A'}`);
  console.log(`   Topic: ${structured.inquiry_topic || 'N/A'}`);
  console.log(`   Transcript: ${transcript ? transcript.length + ' chars' : 'none'}`);
  console.log(`   Recording: ${recordingUrl ? 'yes' : 'no'}`);

  const fromNumber = call.phoneNumber?.number || brand.phone || null;
  const toNumber = call.customer?.number || null;
  const callerPhone = direction === 'outbound' ? toNumber : fromNumber === brand.phone ? toNumber : fromNumber;
  const startedAt = call.startedAt || message.timestamp || new Date().toISOString();
  const durationMs = call.startedAt && call.endedAt
    ? new Date(call.endedAt) - new Date(call.startedAt)
    : null;
  const durationMin = durationMs ? Math.round(durationMs / 60000) : null;

  // Upsert Supabase: if the row exists (status-update:ended already fired),
  // PATCH it. Otherwise INSERT a complete record so we never drop calls.
  const existing = await supabaseRequest('calls', 'GET', null, `?call_id=eq.${call.id}&select=call_id,transcript,summary`);

  // Idempotency guard: if this call has already been fully processed (both
  // transcript and summary present), the sync or an earlier webhook already
  // wrote it + the sheet row + the email. Skip everything to avoid dupes.
  if (existing && existing.length > 0 && existing[0].transcript && existing[0].summary) {
    console.log(`   ⏩ Already fully processed (${call.id}) — skipping`);
    return;
  }

  if (existing && existing.length > 0) {
    await supabaseRequest('calls', 'PATCH', {
      caller_name: structured.caller_name || null,
      caller_email: structured.caller_email || null,
      caller_type: structured.caller_type || 'unknown',
      inquiry_topic: structured.inquiry_topic || null,
      follow_up_needed: structured.follow_up_needed || false,
      summary: analysis.summary || structured.summary || null,
      transcript,
      recording_url: recordingUrl
    }, `?call_id=eq.${call.id}`);
    console.log(`   ✅ Patched existing call row`);
  } else {
    await saveCall({
      call_id: call.id,
      brand: brand.brand,
      caller_phone: callerPhone,
      caller_name: structured.caller_name || null,
      caller_email: structured.caller_email || null,
      caller_type: structured.caller_type || 'unknown',
      inquiry_topic: structured.inquiry_topic || null,
      outcome: call.endedReason || 'completed',
      follow_up_needed: structured.follow_up_needed || false,
      call_duration_min: durationMin,
      summary: analysis.summary || structured.summary || null,
      transcript,
      recording_url: recordingUrl,
      timestamp: startedAt,
      direction,
      metadata: {
        vapi_call_id: call.id,
        assistant_id: call.assistantId,
        end_reason: call.endedReason,
        provider: 'vapi',
        direction
      }
    });
    await updateStatsForCall(brand.brand);
    console.log(`   ✅ Inserted full call row (no prior status-update:ended)`);
  }

  // Always log the call to Google Sheets here (not earlier) because this is
  // where we have summary, caller_name, topic, etc. all populated.
  try {
    await writeCallLog({
      call_id: call.id,
      brand: brand.brand,
      caller_phone: callerPhone || 'unknown',
      caller_name: structured.caller_name,
      caller_email: structured.caller_email,
      caller_type: structured.caller_type || 'unknown',
      inquiry_topic: structured.inquiry_topic,
      outcome: call.endedReason || 'completed',
      follow_up_needed: structured.follow_up_needed,
      duration_min: durationMin,
      summary: analysis.summary || structured.summary
    });
    console.log(`   📞 Call logged to Google Sheets`);
  } catch (err) {
    console.error(`   ❌ Sheets write failed: ${err.message}`);
  }

  // Email a call summary for INBOUND calls only (outbound + WebRTC excluded).
  // Sync caller can pass opts.skipEmail=true to suppress emails on backfill
  // of old calls (avoids flooding the inbox during recovery).
  if (direction === 'inbound' && !opts.skipEmail) {
    try {
      await sendCallSummary({
        brand: brand.brand,
        callerName: structured.caller_name,
        callerPhone,
        callerEmail: structured.caller_email,
        callerType: structured.caller_type,
        topic: structured.inquiry_topic,
        summary: analysis.summary || structured.summary,
        transcript,
        durationMin,
        recordingUrl,
        timestamp: startedAt,
        followUp: structured.follow_up_needed,
        callId: call.id
      });
    } catch (err) {
      console.error(`   ❌ Email summary failed: ${err.message}`);
    }
  }

  if (structured.caller_type !== 'existing_client' && structured.caller_name) {
    try {
      await writeLeadToSheet({
        brand: brand.brand,
        caller_name: structured.caller_name,
        caller_phone: call.customer?.number || call.phoneNumber?.number,
        caller_email: structured.caller_email,
        inquiry_topic: structured.inquiry_topic,
        summary: analysis.summary || structured.summary,
        follow_up_needed: structured.follow_up_needed
      });
      console.log(`   📊 Lead written to Google Sheets (${brand.brand})`);
    } catch (err) {
      console.error(`   ❌ Lead sheet write failed: ${err.message}`);
    }
  }

  try {
    const smsResult = await sendFollowupSMS({
      brand: brand.brand,
      callerPhone: call.customer?.number,
      callerName: structured.caller_name,
      callerType: structured.caller_type
    });
    if (smsResult.sent) {
      console.log(`   📱 Follow-up SMS sent`);
    }
  } catch (err) {
    console.error(`   ❌ Follow-up SMS failed: ${err.message}`);
  }
}

module.exports = {
  handleVapiWebhook,
  handleCallEnded,
  handleEndOfCallReport,
  getBlockedNumbers,
  invalidateBlockCache
};
