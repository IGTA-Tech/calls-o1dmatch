/**
 * Sherrod Voice - Call as Sherrod using his ElevenLabs clone
 * 
 * Usage:
 *   node sherrod-voice.js call <phone> "<message>"
 *   node sherrod-voice.js vip-add <phone> <name>
 *   node sherrod-voice.js vip-list
 */

require('dotenv').config();
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const ENCRYPTED_KEY = process.env.BLAND_ENCRYPTED_KEY;

// Sherrod's cloned voice in Bland.ai (from HeyGen recording)
const SHERROD_VOICE_ID = '2e26fa03-bc41-4933-a0b9-4bf94ca61405';

// ElevenLabs voice (for TTS, not calls)
const ELEVENLABS_SHERROD_VOICE = 'AoNF7UxeFHriZpaG926Z';

// VIP contacts who get answered as Sherrod
const vipContacts = {
  // Format: "phone": "name"
  // Add VIPs here or via API
};

/**
 * Make outbound call AS Sherrod using his voice
 */
async function callAsSherrod(phoneNumber, message) {
  console.log(`📞 Calling ${phoneNumber} as Sherrod...`);
  console.log(`📝 Message: ${message}`);
  
  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Authorization': BLAND_API_KEY,
      'encrypted_key': ENCRYPTED_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      task: `You are Sherrod Seward calling personally. Deliver this message naturally and conversationally: "${message}". Be warm, professional, and direct. After delivering the message, ask if they have any questions or if there's anything else you can help with. End the call politely.`,
      voice: SHERROD_VOICE_ID,
      first_sentence: "Hey, this is Sherrod.",
      model: "enhanced",
      temperature: 0.7,
      record: true,
      from: "+19803032854",  // Sevyn's main line
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      },
      metadata: {
        call_type: "sherrod_direct",
        message: message
      }
    })
  });

  const data = await response.json();
  console.log('Call initiated:', data);
  return data;
}

/**
 * Add VIP contact (answers as Sherrod when they call)
 */
function addVIP(phone, name) {
  vipContacts[phone] = name;
  console.log(`✅ Added VIP: ${name} (${phone})`);
  console.log('When this person calls, Sevyn will answer as Sherrod.');
  return { phone, name, added: true };
}

/**
 * Check if caller is VIP
 */
function isVIP(phone) {
  return vipContacts.hasOwnProperty(phone);
}

/**
 * List all VIP contacts
 */
function listVIPs() {
  console.log('=== VIP Contacts (Answer as Sherrod) ===');
  Object.entries(vipContacts).forEach(([phone, name]) => {
    console.log(`  ${name}: ${phone}`);
  });
  return vipContacts;
}

// CLI
if (require.main === module) {
  const [,, action, ...args] = process.argv;
  
  (async () => {
    switch(action) {
      case 'call':
        const phone = args[0];
        const message = args.slice(1).join(' ');
        if (!phone || !message) {
          console.log('Usage: node sherrod-voice.js call <phone> "<message>"');
          process.exit(1);
        }
        await callAsSherrod(phone, message);
        break;
      
      case 'vip-add':
        const vipPhone = args[0];
        const vipName = args.slice(1).join(' ');
        if (!vipPhone || !vipName) {
          console.log('Usage: node sherrod-voice.js vip-add <phone> <name>');
          process.exit(1);
        }
        addVIP(vipPhone, vipName);
        break;
      
      case 'vip-list':
        listVIPs();
        break;
      
      default:
        console.log('Sherrod Voice - Call as Sherrod');
        console.log('');
        console.log('Commands:');
        console.log('  node sherrod-voice.js call <phone> "<message>"');
        console.log('  node sherrod-voice.js vip-add <phone> <name>');
        console.log('  node sherrod-voice.js vip-list');
        console.log('');
        console.log('Example:');
        console.log('  node sherrod-voice.js call +15551234567 "Hey, I wanted to follow up on our conversation earlier. Give me a call when you get a chance."');
    }
  })();
}

module.exports = { callAsSherrod, addVIP, isVIP, listVIPs, SHERROD_VOICE_ID };
