# Deployment Runbook — calls.o1dmatch.com

Step-by-step to get this app running in prod alongside (not replacing) the main
Adriana Command Center. Follow in order. Do not cut traffic over until the
parallel test passes.

---

## Phase 1 — Stand up the new Railway service (NO traffic yet)

The new app should run side-by-side with the existing Command Center for 3–5
days before any cutover. During that window, the existing app keeps handling
all 6 brands; the new app sits idle until we manually flip the webhooks.

### 1.1 Create Railway service

1. Railway dashboard → New Project → Deploy from GitHub repo →
   `IGTA-Tech/calls-o1dmatch`
2. Railway will auto-detect the Dockerfile and start building.
3. While it builds, set env vars (see 1.2).

### 1.2 Environment variables

Most can be copy-pasted from the existing Command Center Railway service
(same Supabase, same Vapi, same Twilio, same Resend, same Google service
account). The ones that **must change** are highlighted.

```bash
# Server
PORT=3850
BASE_URL=https://calls.o1dmatch.com    # ← set after DNS is live; until then use the .railway.app URL

# Twilio (same as Command Center)
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_API_KEY=SK…
TWILIO_API_SECRET=…
TWILIO_TWIML_APP_SID=AP…
TWILIO_PHONE_NUMBER=+15617944621   # ← O1dMatch number, not the SSV one

# OpenAI (same)
OPENAI_API_KEY=sk-…

# Supabase (same — shared DB, filtered by brand)
SUPABASE_URL=https://….supabase.co
SUPABASE_KEY=…
SUPABASE_SERVICE_KEY=…

# Vapi (same)
VOICE_PROVIDER=vapi
VAPI_API_KEY=…

# Google Sheets — NEW sheet for O1dMatch only
CALL_LOG_SHEET_ID=<NEW SHEET ID>   # ← set in Phase 2
MASTER_LEAD_SHEET_ID=10yzVfq3aH89c2UUMJrI5PCrXv_vK1NIBm3jM2IlbIu4   # shared, lookup-only
CASES_SHEET_ID=1Ma1_6kERm9CpDnyb_F1N_IvaEYlitdt-p5q1Oop5pWg          # shared, lookup-only
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",…}             # same JSON

# Resend (same key — recipient changes per app)
RESEND_API_KEY=re_…
CALL_SUMMARY_EMAIL=sherrod@sherrodsportsvisas.com
CALL_SUMMARY_FROM=Adriana <calls@innovativeautomations.dev>

# Auth — generate a NEW JWT secret for this app (don't reuse Command Center's)
JWT_SECRET=<run: openssl rand -hex 32>
```

### 1.3 Verify build

Once Railway shows "Active" with a green check:

```bash
curl https://<railway-url>/health
# → { ok: true, … }
```

If health returns 200, the server booted. Move on.

---

## Phase 2 — Create the new Google Sheet

1. In Google Drive, create a new sheet named **"O1dMatch Call Log"**. Put it
   in a folder the O1dMatch team owns.
2. Add three tabs (exact names):
   - `O1dMatch`
   - `Sevyn Sales Training`
   - `All Calls`
3. In each tab, paste this header row at A1:
   ```
   Timestamp | Brand | Caller Phone | Caller Name | Caller Email | Type | Inquiry Topic | Outcome | Follow Up | Duration (min) | Summary | Call ID
   ```
4. Share the sheet with the service-account email (the same `client_email` in
   `GOOGLE_SERVICE_ACCOUNT_JSON`) as Editor.
5. Copy the sheet ID from the URL: `docs.google.com/spreadsheets/d/<ID>/edit`
6. Set `CALL_LOG_SHEET_ID` to that ID in Railway and redeploy.
7. Verify: `curl https://<railway-url>/api/sheets/test` — should return tabs.

---

## Phase 3 — DNS for calls.o1dmatch.com

1. In whatever DNS provider holds `o1dmatch.com` (Cloudflare?), add a CNAME:
   - **Host:** `calls`
   - **Target:** the Railway-generated domain (e.g. `…up.railway.app`)
   - **Proxy:** off (let Railway terminate TLS)
2. In Railway → Settings → Domains, add `calls.o1dmatch.com` as a custom
   domain. Railway provisions the cert in ~1 minute.
3. Update `BASE_URL` env var to `https://calls.o1dmatch.com`. Redeploy.

---

## Phase 4 — Parallel test (3–5 days)

During this window, **do not change** Vapi webhooks or Twilio voice URLs.
The Command Center keeps handling everything. The new app:

- Can be logged into at `https://calls.o1dmatch.com`
- Will show all historical O1dMatch + Sevyn calls from the shared DB
- Won't receive any new webhook traffic yet

Things to verify by hand:

- [ ] Login works (create test user via Supabase Auth dashboard)
- [ ] Dashboard shows O1dMatch + Sevyn historical calls only
- [ ] Call history page loads, search/filter work
- [ ] Click into a call — transcript + recording playback works
- [ ] Human click-to-call works (test outbound from dashboard)
- [ ] Google Sheet `/api/sheets/test` returns tabs

---

## Phase 5 — Cutover (the moment of truth)

When Phase 4 is clean, repoint live traffic:

### 5.1 Vapi — point assistants at the new app

For each of the two assistants (O1dMatch and Sevyn) in the Vapi dashboard:

1. Edit the assistant
2. Change **Server URL** from
   `https://<command-center>.up.railway.app/vapi/webhook` to
   `https://calls.o1dmatch.com/vapi/webhook`
3. Save

### 5.2 Twilio — voice webhooks

If Vapi's phone-number registration manages this automatically, no action
needed. Otherwise, for each of the two Twilio numbers:

1. Twilio Console → Phone Numbers → +1 561-794-4621 (and +1 980-303-2854)
2. Voice webhook → `https://calls.o1dmatch.com/voice` (or whatever the Vapi
   registration produced)
3. Save

### 5.3 Test inbound

- Call `+1 561-794-4621` — should reach Adriana O1dMatch greeting
- Within ~30s of hanging up, check `https://calls.o1dmatch.com` — call should
  appear in dashboard with transcript + summary
- Sherrod should receive a summary email

If anything breaks, revert by switching Vapi `serverUrl` back to the Command
Center webhook URL.

---

## Phase 6 — Strip O1dMatch + Sevyn from the Command Center

Only after Phase 5 has been stable for 24h. The two brands' historical rows
stay in the shared DB — they just stop being displayed in the Command Center
UI and stop receiving new writes from that app.

In the `sevyn-sms-agent` repo:

1. `voice/vapi-client.js` — delete the `+15617944621` (O1dMatch) and
   `+19803032854` (Sevyn) entries from `PROMPT_FILES`, `BRAND_CONFIGS`,
   `BRAND_PHONES`
2. `database/sheets.js` — delete the `O1dMatch` and `Sevyn` entries from
   `CALL_LOG_TABS` and `BRAND_TABS`
3. `public/index.html` — remove O1dMatch and Sevyn from the `brands` array
   (around line 454)
4. `public/calls.html` — remove from the brand filter dropdown and the
   `brandColors` maps
5. `server.js` — remove from `SMS_BRAND_NAMES` (around line 212)
6. Delete prompts: `prompts/o1dmatch-enhanced.txt`,
   `prompts/o1dmatch-ops-mode.txt`, `prompts/sevyn-sales-training.txt`,
   `prompts/sevyn-ops-mode.txt`
7. Commit, push, deploy

---

## Security hygiene (do before going wide)

The fork inherited these legacy files from the source repo, which I removed
from the new repo (and were blocked by GitHub secret scanning):

- `call-webhook.js` — had a hardcoded Airtable API key
- `stripe-conversion.js` — had a hardcoded Stripe key

**Both keys are still active in the sevyn-sms-agent repo's git history.**
Rotate them:

- [ ] Airtable PAT `patHRNm3A3LJtOm9l.…` — Airtable → Developer Hub → Personal
  access tokens → revoke + create new
- [ ] Stripe key — Stripe Dashboard → Developers → API keys → roll

---

## Rollback

If anything in Phase 5 goes sideways:

1. Vapi → set both assistant `serverUrl`s back to the Command Center webhook
2. Command Center continues handling O1dMatch + Sevyn as before
3. Investigate in `calls-o1dmatch` Railway logs
