/**
 * Push prompt files to existing Vapi assistants.
 * Safer than re-running provision-vapi.js — does NOT touch phone-number
 * registrations or SIP routing.
 *
 * Run: VAPI_API_KEY=... node scripts/update-vapi-prompts.js
 */

require('dotenv').config();
const { BRAND_CONFIGS, listAssistants, updateAssistant } = require('../voice/vapi-client');

const WEBHOOK_URL = (process.env.BASE_URL
  || process.env.PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  || 'https://calls.o1dmatch.com')
  + '/vapi/webhook';

(async () => {
  if (!process.env.VAPI_API_KEY) {
    console.error('VAPI_API_KEY required');
    process.exit(1);
  }
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);

  const existing = await listAssistants();
  let updated = 0, skipped = 0, failed = 0;

  for (const [phone, config] of Object.entries(BRAND_CONFIGS)) {
    const expectedName = `${config.brand} - ${config.agent_name}`;
    const assistant = existing.find(a => a.name === expectedName);
    if (!assistant) {
      console.log(`  ⏭️  ${expectedName} — not found, skipping`);
      skipped++;
      continue;
    }
    try {
      const fullConfig = { ...config, prompt: config.prompt };
      await updateAssistant(assistant.id, fullConfig, WEBHOOK_URL);
      const promptLen = fullConfig.prompt?.length || 0;
      console.log(`  ✅ ${expectedName} (${assistant.id}) — prompt: ${promptLen} chars`);
      updated++;
    } catch (err) {
      console.log(`  ❌ ${expectedName}: ${err.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
