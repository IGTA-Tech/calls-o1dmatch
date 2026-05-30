/**
 * Vapi periodic sync — safety net for missed webhook deliveries.
 *
 * Vapi's webhook delivery has been observed to silently drop events. To
 * guarantee no call is missed, this module polls the Vapi API every 90s,
 * compares against Supabase, and processes anything missing by calling
 * handleEndOfCallReport directly (in-process, no HTTP roundtrip).
 *
 * Hardening:
 *   - Race guard: skip calls younger than 2 minutes so we don't race the
 *     real webhook when Vapi DOES deliver it.
 *   - Email guard: pass skipEmail=true for calls older than 30 minutes so
 *     a sync after downtime doesn't flood the inbox with old summaries.
 *   - Idempotent: handleEndOfCallReport already upserts (PATCH if row
 *     exists, INSERT otherwise) so re-runs are safe.
 *   - Concurrency lock: refuses to start a second sync if one is in flight.
 *
 * Started from sevyn-sms.js on boot when VOICE_PROVIDER=vapi.
 */

const { supabaseRequest } = require('../database/supabase');

const SYNC_INTERVAL_MS    = 30 * 1000;      // run every 30s
const LOOKBACK_MS         = 60 * 60 * 1000; // look at calls from the last hour
const RACE_GUARD_MS       = 30 * 1000;      // skip calls < 30s old (let webhook win)
const EMAIL_THRESHOLD_MS  = 30 * 60 * 1000; // suppress email for calls > 30 min old

let intervalHandle = null;
let isRunning = false;

async function vapiGet(path) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Vapi GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncOnce() {
  if (isRunning) {
    console.log('🔄 Vapi sync: previous run still in flight, skipping');
    return;
  }
  isRunning = true;
  const t0 = Date.now();
  let checked = 0, fixed = 0, errors = 0;

  try {
    // 1. Pull recent Vapi calls (one page is plenty given LOOKBACK_MS)
    const calls = await vapiGet('/call?limit=50');

    // Filter to inbound calls that ended within our lookback window and
    // have transcript/analysis (so they're actually worth processing).
    const now = Date.now();
    const candidates = calls.filter(c => {
      if (c.type !== 'inboundPhoneCall') return false;
      if (c.status !== 'ended') return false;
      const endedAt = c.endedAt ? new Date(c.endedAt).getTime() : null;
      if (!endedAt) return false;
      const ageMs = now - endedAt;
      if (ageMs > LOOKBACK_MS) return false;       // too old
      if (ageMs < RACE_GUARD_MS) return false;     // too young — let webhook fire first
      if (!c.artifact?.transcript && !c.transcript) return false; // no useful data yet
      return true;
    });

    if (candidates.length === 0) {
      isRunning = false;
      return;
    }

    // 2. Get which ones are already in Supabase
    const ids = candidates.map(c => c.id);
    const idList = ids.map(i => `"${i}"`).join(',');
    const existingRows = await supabaseRequest(
      'calls',
      'GET',
      null,
      `?call_id=in.(${idList})&select=call_id,transcript,summary`
    );
    const existingMap = new Map((existingRows || []).map(r => [r.call_id, r]));

    // 3. Anything missing OR present-but-missing-transcript → process it
    const toProcess = candidates.filter(c => {
      const row = existingMap.get(c.id);
      if (!row) return true;                          // not in DB
      if (!row.transcript || !row.summary) return true; // in DB but incomplete
      return false;
    });

    if (toProcess.length === 0) {
      console.log(`🔄 Vapi sync: ${candidates.length} candidates, all up to date (${Date.now() - t0}ms)`);
      isRunning = false;
      return;
    }

    console.log(`🔄 Vapi sync: ${toProcess.length} call(s) need processing`);

    // 4. Process each by calling handleEndOfCallReport directly
    const { handleEndOfCallReport } = require('./vapi-webhook');

    for (const summary of toProcess) {
      checked++;
      try {
        const full = await vapiGet('/call/' + summary.id);
        const ageMs = now - new Date(full.endedAt).getTime();
        const skipEmail = ageMs > EMAIL_THRESHOLD_MS;

        const message = {
          type: 'end-of-call-report',
          call: full,
          artifact: full.artifact,
          analysis: full.analysis,
          endedReason: full.endedReason,
          timestamp: full.endedAt
        };
        await handleEndOfCallReport(message, { skipEmail });
        console.log(`   ✅ Backfilled ${summary.id.substring(0,18)} (${Math.round(ageMs / 1000)}s old, email=${skipEmail ? 'skipped' : 'sent'})`);
        fixed++;
      } catch (err) {
        errors++;
        console.error(`   ❌ Sync error on ${summary.id?.substring(0,18)}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`🔄 Vapi sync failed: ${err.message}`);
  } finally {
    isRunning = false;
    if (checked > 0) {
      console.log(`🔄 Vapi sync done: ${fixed}/${checked} ok, ${errors} errors (${Date.now() - t0}ms)`);
    }
  }
}

function startVapiSync() {
  if (intervalHandle) {
    console.log('🔄 Vapi sync already running');
    return;
  }
  if (!process.env.VAPI_API_KEY) {
    console.log('🔄 Vapi sync NOT starting: VAPI_API_KEY not set');
    return;
  }
  console.log(`🔄 Vapi sync starting (every ${SYNC_INTERVAL_MS / 1000}s, ${LOOKBACK_MS / 60000}min lookback)`);

  // First sweep after a short delay so the server is warmed up.
  setTimeout(() => syncOnce().catch(err => console.error('sync:', err.message)), 5000);
  intervalHandle = setInterval(
    () => syncOnce().catch(err => console.error('sync:', err.message)),
    SYNC_INTERVAL_MS
  );
}

function stopVapiSync() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startVapiSync, stopVapiSync, syncOnce };
