# O1dMatch Calls

Vapi-powered voice ops + dashboard for O1dMatch and the Sevyn sales-training agent.

Lives at **calls.o1dmatch.com**. Forked from the multi-brand Adriana Command Center; this build handles **only** O1dMatch and Sevyn so the O1dMatch team has a standalone surface.

## What it does

- Answers inbound voice calls to the O1dMatch number with Adriana (Vapi assistant), and the Sevyn number with the sales-training evaluator
- Captures transcript + AI summary + structured extraction (name, email, topic, follow-up) for every call
- Logs to Supabase (shared with the main Command Center, filtered by `brand`)
- Logs to a dedicated O1dMatch Google Sheet (3 tabs: O1dMatch / Sevyn Sales Training / All Calls)
- Emails inbound call summaries via Resend
- Dashboard with call history, transcripts, recordings, search/filter
- Human click-to-call from the dashboard (Twilio WebRTC + Whisper transcription)

## Quick start (local)

```bash
npm install
cp .env.example .env   # fill in real values
npm start
```

Server runs on `PORT` (default `3850`).

## Phone numbers handled

| Number | Brand | Voice ID |
|---|---|---|
| `+1 561-794-4621` | O1dMatch (Adriana) | 11labs Rachel |
| `+1 980-303-2854` | Sevyn Sales Training | 11labs Bella |

Voice webhooks for both numbers should point at this app's `/vapi/webhook` once cut over.

## Deployment (Railway)

1. Connect this repo to a new Railway service. Dockerfile is at the root.
2. Set the env vars in `.env.example` (the production values are in the main Command Center service — most can be reused as-is since Supabase / Resend / Vapi / Twilio are shared).
3. Set the `CALL_LOG_SHEET_ID` to the **new** O1dMatch-owned Google Sheet (not the shared one).
4. After deploy, point `calls.o1dmatch.com` at the Railway service via DNS CNAME.
5. In Vapi, repoint the O1dMatch + Sevyn assistant `serverUrl` to `https://calls.o1dmatch.com/vapi/webhook`.
6. In Twilio, change the voice webhook on both numbers to `https://calls.o1dmatch.com/voice` (Vapi-managed) — or rely on Vapi's phone-number registration which handles this automatically.

## How it shares data with the main Command Center

- **Same Supabase DB** — both apps point at the same project. The `calls` table has a `brand` column; this app filters to `O1dMatch` and `Sevyn` only.
- **Separate Google Sheet for call logs** — the new sheet lives in the O1dMatch team's Drive and is set via `CALL_LOG_SHEET_ID`. The shared master-lead and cases sheets (`MASTER_LEAD_SHEET_ID`, `CASES_SHEET_ID`) default to the existing Sherrod sheets so client lookup still works.
- **Independent auth** — separate Supabase Auth users for the O1dMatch team.

## Prompts

- `prompts/o1dmatch-enhanced.txt` — Adriana's O1dMatch script
- `prompts/o1dmatch-ops-mode.txt` — current operating-mode addendum
- `prompts/sevyn-sales-training.txt` — Sevyn's sales-rep evaluator
- `prompts/_pronunciation.txt` — visa-class pronunciation rules (prepended to every prompt)

## Branding

Navy `#0B1C3A` + gold `#C9A96E` to match `o1dmatch.com`. UI lives in `public/{login,index,calls,admin}.html`.
