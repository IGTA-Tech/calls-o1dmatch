/**
 * Backfill Vapi transcripts + recording URLs into Supabase.
 *
 * Why: handleEndOfCallReport used to skip these fields, so any Vapi call
 * already in the DB has transcript=null. Vapi keeps call data for ~30 days,
 * so we can pull each call from their API and patch the row.
 *
 * Usage:
 *   VAPI_API_KEY=... SUPABASE_URL=... SUPABASE_KEY=... \
 *     node scripts/backfill-vapi-transcripts.js
 *
 * Pass --dry to preview without writing.
 */

require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry');
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!VAPI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env: VAPI_API_KEY, SUPABASE_URL, SUPABASE_KEY all required');
  process.exit(1);
}

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'PATCH' ? 'return=minimal' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status}: ${await res.text()}`);
  return method === 'PATCH' ? null : res.json();
}

async function vapi(callId) {
  const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Vapi GET /call/${callId} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalize(transcript) {
  if (!transcript) return null;
  return transcript.replace(/^AI:/gm, 'Agent:').replace(/\nAI:/g, '\nAgent:');
}

async function vapiList(path) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Vapi GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  // Walk every Vapi call (most recent 100), then upsert: PATCH if the row
  // exists in Supabase, INSERT if missing. Source of truth is Vapi — the
  // webhook may have failed entirely, so we can't trust Supabase to even
  // contain a row.
  const vapiCalls = await vapiList('/call?limit=100');
  console.log(`Vapi returned ${vapiCalls.length} calls.`);

  // Build assistantId → brand mapping by looking up each assistant once.
  const assistantBrand = {};
  for (const a of await vapiList('/assistant')) {
    // Assistant name format from provision-vapi.js: "{Brand} - {AgentName}"
    const m = a.name?.match(/^(.+?)\s+-\s+/);
    if (m) assistantBrand[a.id] = m[1];
  }

  const phoneBrand = {};
  for (const p of await vapiList('/phone-number')) {
    if (p.assistantId && assistantBrand[p.assistantId]) {
      phoneBrand[p.number] = assistantBrand[p.assistantId];
    }
  }

  if (DRY_RUN) console.log('[dry-run] no writes will happen.\n');

  let inserted = 0, patched = 0, skipped = 0, errors = 0;

  for (const summary of vapiCalls) {
    const id = summary.id;
    process.stdout.write(`  ${id} (${summary.type}, ${summary.endedReason || summary.status}) ... `);

    try {
      const call = await vapi(id);
      const artifact = call.artifact || {};
      const transcript = normalize(artifact.transcript || call.transcript || null);
      const recordingUrl = artifact.recordingUrl || artifact.stereoRecordingUrl || call.recordingUrl || null;
      const aiSummary = call.analysis?.summary || null;
      const structured = call.analysis?.structuredData || {};

      const direction = call.type?.includes('outbound') ? 'outbound' : 'inbound';
      const fromNumber = call.phoneNumber?.number || null;
      const toNumber = call.customer?.number || null;
      const callerPhone = direction === 'outbound' ? toNumber : fromNumber;
      const brand = assistantBrand[call.assistantId] || phoneBrand[fromNumber] || 'Unknown';

      const startedAt = call.startedAt || call.createdAt;
      const endedAt = call.endedAt;
      const durationMin = startedAt && endedAt
        ? Math.round((new Date(endedAt) - new Date(startedAt)) / 60000)
        : null;

      // Does it exist?
      const existing = await supabase('GET', `calls?call_id=eq.${id}&select=call_id,transcript`);

      if (existing.length === 0) {
        // INSERT — call never made it into the DB
        if (!transcript && !recordingUrl && !aiSummary) {
          console.log('not in DB and no useful data');
          skipped++;
          continue;
        }
        const row = {
          call_id: id,
          brand,
          caller_phone: callerPhone || 'unknown',
          caller_name: structured.caller_name || null,
          caller_email: structured.caller_email || null,
          caller_type: structured.caller_type || 'unknown',
          inquiry_topic: structured.inquiry_topic || null,
          outcome: call.endedReason || call.status || 'completed',
          follow_up_needed: structured.follow_up_needed || false,
          call_duration_min: durationMin,
          summary: aiSummary,
          transcript,
          recording_url: recordingUrl,
          timestamp: startedAt || new Date().toISOString(),
          direction,
          metadata: {
            vapi_call_id: id,
            assistant_id: call.assistantId,
            end_reason: call.endedReason,
            provider: 'vapi',
            direction,
            backfilled: true
          }
        };
        if (DRY_RUN) {
          console.log(`would INSERT (${brand}, ${direction}, ${callerPhone}, ${durationMin}min, transcript=${transcript ? 'yes' : 'no'})`);
        } else {
          await supabase('POST', 'calls', row);
          console.log(`✅ INSERTED (${brand}, ${direction}, ${callerPhone})`);
        }
        inserted++;
      } else {
        // PATCH if missing transcript or recording
        if (existing[0].transcript) {
          console.log('already has transcript');
          skipped++;
          continue;
        }
        const patch = {};
        if (transcript) patch.transcript = transcript;
        if (recordingUrl) patch.recording_url = recordingUrl;
        if (aiSummary) patch.summary = aiSummary;
        if (Object.keys(patch).length === 0) {
          console.log('nothing to patch');
          skipped++;
          continue;
        }
        if (DRY_RUN) {
          console.log(`would PATCH ${Object.keys(patch).join(',')}`);
        } else {
          await supabase('PATCH', `calls?call_id=eq.${id}`, patch);
          console.log(`✅ PATCHED ${Object.keys(patch).join(',')}`);
        }
        patched++;
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. inserted=${inserted} patched=${patched} skipped=${skipped} errors=${errors}`);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
