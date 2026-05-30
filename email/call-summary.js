/**
 * Send a call-summary email after an inbound call's AI analysis completes.
 * Uses Resend (https://resend.com) for delivery.
 *
 * Configured via env vars:
 *   RESEND_API_KEY        — required
 *   CALL_SUMMARY_EMAIL    — recipient (defaults to Yusuf's email for testing)
 *   CALL_SUMMARY_FROM     — sender, e.g. "Adriana <onboarding@resend.dev>"
 *                            (Resend default works without a verified domain)
 *
 * If RESEND_API_KEY is missing the function is a no-op — the rest of the
 * webhook pipeline continues uninterrupted.
 */

const DEFAULT_TO   = 'yusuf.awodire@innovativeautomations.dev';
const DEFAULT_FROM = 'Adriana <onboarding@resend.dev>';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSubject({ brand, callerName, callerPhone }) {
  const who = callerName || callerPhone || 'Unknown caller';
  return `📞 New call — ${brand} — ${who}`;
}

function buildHtml(c) {
  const when = c.timestamp
    ? new Date(c.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
  const transcriptHtml = c.transcript
    ? esc(c.transcript)
        .replace(/^(Agent|AI|Assistant|Adriana):/gm, '<strong style="color:#C9A96E">Adriana:</strong>')
        .replace(/^(User|Caller):/gm, '<strong style="color:#3b82f6">Caller:</strong>')
        .replace(/\n/g, '<br>')
    : '<em>No transcript captured</em>';

  return `<!DOCTYPE html>
<html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;padding:24px;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <div style="background:#0B1C3A;padding:24px;color:#fff;border-bottom:3px solid #C9A96E;">
      <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;">New call</h2>
      <p style="margin:0;opacity:0.9;font-size:14px;">${esc(c.brand || 'Unknown brand')}</p>
    </div>
    <div style="padding:24px;">
      <h3 style="margin:0 0 4px;font-size:16px;font-weight:600;">${esc(c.callerName || 'Unknown caller')}</h3>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">
        ${esc(c.callerPhone || '')}${c.callerEmail ? ' · ' + esc(c.callerEmail) : ''}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:100px;">When</td><td style="padding:6px 0;">${esc(when)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Duration</td><td style="padding:6px 0;">${c.durationMin != null ? c.durationMin + ' min' : '—'}</td></tr>
        ${c.topic ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Topic</td><td style="padding:6px 0;">${esc(c.topic)}</td></tr>` : ''}
        ${c.callerType && c.callerType !== 'unknown' ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Type</td><td style="padding:6px 0;text-transform:capitalize;">${esc(c.callerType.replace(/_/g,' '))}</td></tr>` : ''}
        ${c.followUp ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Follow-up</td><td style="padding:6px 0;color:#d97706;"><strong>Yes — needs callback</strong></td></tr>` : ''}
      </table>

      ${c.summary ? `<div style="background:#f3f4f6;padding:14px;border-radius:8px;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">AI Summary</p>
        <p style="margin:0;font-size:14px;line-height:1.55;">${esc(c.summary)}</p>
      </div>` : ''}

      ${c.recordingUrl ? `<p style="margin:16px 0;"><a href="${esc(c.recordingUrl)}" style="display:inline-block;padding:10px 18px;background:#C9A96E;color:#0B1C3A;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">▶ Listen to recording</a></p>` : ''}

      <details style="margin-top:16px;">
        <summary style="cursor:pointer;font-size:13px;color:#6b7280;font-weight:500;padding:8px 0;">Show full transcript</summary>
        <div style="background:#f9fafb;padding:14px;border-radius:8px;margin-top:8px;font-size:13px;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;">
          ${transcriptHtml}
        </div>
      </details>

      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">Call ID: <span style="font-family:ui-monospace,monospace;">${esc(c.callId)}</span></p>
    </div>
  </div>
</body></html>`;
}

async function sendCallSummary(call) {
  if (!process.env.RESEND_API_KEY) {
    console.log('   ⚠️ RESEND_API_KEY not set — skipping summary email');
    return { sent: false, reason: 'no_api_key' };
  }
  const to   = process.env.CALL_SUMMARY_EMAIL || DEFAULT_TO;
  const from = process.env.CALL_SUMMARY_FROM  || DEFAULT_FROM;
  const subject = buildSubject(call);
  const html = buildHtml(call);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`   📧 Call summary emailed to ${to} (${data.id || 'sent'})`);
      return { sent: true, id: data.id };
    }
    const errText = await res.text();
    console.error(`   ❌ Resend ${res.status}: ${errText.substring(0, 200)}`);
    return { sent: false, error: `${res.status}: ${errText}` };
  } catch (err) {
    console.error(`   ❌ Resend error: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendCallSummary };
