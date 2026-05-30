/**
 * Sevyn Call - Make calls from Sevyn's unified number (980) 303-2854
 * 
 * Usage:
 *   node sevyn-call.js <phone> "<message>"
 *   node sevyn-call.js +17046505837 "Hey, this is Sevyn following up from earlier!"
 */

require('dotenv').config();
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const ENCRYPTED_KEY = process.env.BLAND_ENCRYPTED_KEY;
const SEVYN_VOICE = '4e1209ed-ef44-4ab8-aa6f-905d598df489';  // Colombiana
const SEVYN_NUMBER = '+19803032854';

/**
 * Make call as Sevyn
 */
async function callAsSevyn(phoneNumber, message, options = {}) {
  // Normalize phone number
  let phone = phoneNumber.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) {
    phone = '+1' + phone;
  }

  console.log(`📞 Sevyn calling ${phone}...`);
  console.log(`💬 Message: ${message}`);

  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Authorization': BLAND_API_KEY,
      'encrypted_key': ENCRYPTED_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_number: phone,
      from: SEVYN_NUMBER,
      task: `You are Sevyn Stark, Sherrod Seward's AI assistant. You have a professional, confident, laid-back Latina vibe - chill, seasoned, and approachable.

Your task: ${message}

Be natural and conversational. Listen to their response. If they have questions, answer helpfully. End the call warmly.`,
      voice: SEVYN_VOICE,
      first_sentence: options.firstSentence || "Hey! This is Sevyn, Sherrod's assistant.",
      model: "enhanced",
      temperature: 0.7,
      record: true,
      max_duration: options.maxDuration || 300,
      wait_for_greeting: options.waitForGreeting || false,
      language: options.language || "en-US"
    })
  });

  const data = await response.json();
  
  if (data.status === 'success') {
    console.log('✅ Call queued!');
    console.log(`📋 Call ID: ${data.call_id}`);
    console.log(`📱 From: ${SEVYN_NUMBER}`);
    return data;
  } else {
    console.error('❌ Call failed:', data);
    return data;
  }
}

// CLI interface
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
Sevyn Call - Make AI calls from (980) 303-2854

Usage:
  node sevyn-call.js <phone> "<message>"

Examples:
  node sevyn-call.js +17046505837 "Following up about our earlier conversation"
  node sevyn-call.js 5617408303 "Quick reminder about the meeting at 3pm"
`);
  process.exit(1);
}

const [phone, message] = args;
callAsSevyn(phone, message);
