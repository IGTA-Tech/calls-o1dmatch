/**
 * One-time Vapi provisioning script.
 * Creates one assistant per brand and registers the matching Twilio number
 * with Vapi (so inbound calls route to the assistant automatically).
 *
 * Run: node scripts/provision-vapi.js
 *
 * Requires env: VAPI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RAILWAY_PUBLIC_DOMAIN
 *
 * Idempotent: if an assistant or phone number already exists with the same
 * name/number, it updates instead of creating duplicates.
 */

require('dotenv').config();

const {
  BRAND_CONFIGS,
  createAssistant,
  updateAssistant,
  listAssistants,
  registerPhoneNumber,
  listPhoneNumbers,
  vapiRequest
} = require('../voice/vapi-client');

const WEBHOOK_URL = (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.PUBLIC_URL || 'https://claude.sevynopenclaw.com')
  + '/vapi/webhook';

async function main() {
  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY not set');
    process.exit(1);
  }
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('❌ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
    process.exit(1);
  }

  console.log(`🌐 Webhook URL: ${WEBHOOK_URL}\n`);

  console.log('📋 Fetching existing assistants...');
  const existingAssistants = await listAssistants();
  console.log(`   Found ${existingAssistants.length} existing assistant(s)\n`);

  console.log('📞 Fetching existing phone numbers...');
  const existingPhones = await listPhoneNumbers();
  console.log(`   Found ${existingPhones.length} existing phone number(s)\n`);

  const assistantMap = {}; // brand -> assistantId

  for (const [phone, config] of Object.entries(BRAND_CONFIGS)) {
    const fullConfig = { ...config, prompt: config.prompt };
    const expectedName = `${fullConfig.brand} - ${fullConfig.agent_name}`;

    let assistant = existingAssistants.find(a => a.name === expectedName);
    try {
      if (assistant) {
        await updateAssistant(assistant.id, fullConfig, WEBHOOK_URL);
        console.log(`   🔄 Updated assistant: ${expectedName} (${assistant.id})`);
      } else {
        assistant = await createAssistant(fullConfig, WEBHOOK_URL);
        console.log(`   ✨ Created assistant: ${expectedName} (${assistant.id})`);
      }
      assistantMap[fullConfig.brand] = assistant.id;
    } catch (err) {
      console.error(`   ❌ Assistant for ${fullConfig.brand}: ${err.message}`);
      continue;
    }

    // Register or re-link the Twilio number
    const existingPhone = existingPhones.find(p => p.number === phone);
    try {
      if (existingPhone) {
        await vapiRequest('PATCH', `/phone-number/${existingPhone.id}`, {
          assistantId: assistant.id
        });
        console.log(`   🔗 Re-linked ${phone} → ${fullConfig.brand}`);
      } else {
        const reg = await registerPhoneNumber(phone, assistant.id);
        console.log(`   📞 Registered ${phone} → ${fullConfig.brand} (${reg.id})`);
      }
    } catch (err) {
      console.error(`   ❌ Phone ${phone}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n✅ Provisioning complete.');
  console.log('\nAssistant IDs (add to Railway env vars):');
  for (const [brand, id] of Object.entries(assistantMap)) {
    const envName = brand.replace(/[^a-zA-Z0-9]/g, '');
    console.log(`   VAPI_ASSISTANT_${envName}=${id}`);
  }
  console.log('\nNext steps:');
  console.log('  1. Set VOICE_PROVIDER=vapi on Railway');
  console.log('  2. Redeploy');
  console.log('  3. Test inbound + outbound calls');
}

main().catch(err => {
  console.error('Provisioning failed:', err);
  process.exit(1);
});
