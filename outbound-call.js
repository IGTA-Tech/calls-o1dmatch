#!/usr/bin/env node
/**
 * Sevyn Outbound Call System
 * Usage: node outbound-call.js <phone> "<task>" [options]
 * 
 * Examples:
 *   node outbound-call.js +12087154601 "Ask about payment status for Florian case"
 *   node outbound-call.js +15551234567 "Follow up on signed documents" --voice=nat
 */

require('dotenv').config();
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const DEFAULT_VOICE = 'nat';  // Female voice for Sevyn

async function makeCall(phoneNumber, task, options = {}) {
  const payload = {
    phone_number: phoneNumber,
    task: `You are Sevyn, a professional assistant calling from Sherrod Sports Visas. ${task}`,
    voice: options.voice || DEFAULT_VOICE,
    first_sentence: options.firstSentence || "Hi, this is Sevyn calling from Sherrod Sports Visas.",
    record: true,  // ALWAYS record for transcripts
    max_duration: options.maxDuration || 10,  // Up to 10 minutes
    wait_for_greeting: true,
    model: 'enhanced',
    analysis_prompt: 'Summarize the key points: 1) Did they agree to pay? 2) When? 3) Will they sign documents? 4) Any concerns or objections?',
    analysis_schema: {
      will_pay: { type: 'boolean', description: 'Did they commit to paying?' },
      payment_timeline: { type: 'string', description: 'When did they say they would pay?' },
      will_sign: { type: 'boolean', description: 'Did they agree to sign documents?' },
      concerns: { type: 'string', description: 'Any concerns or objections raised?' },
      next_steps: { type: 'string', description: 'Agreed next steps' }
    }
  };

  console.log('📞 Initiating call to:', phoneNumber);
  console.log('📋 Task:', task);
  console.log('');

  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      'authorization': BLAND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  
  if (result.call_id) {
    console.log('✅ Call initiated!');
    console.log('📱 Call ID:', result.call_id);
    console.log('');
    console.log('To check status/transcript:');
    console.log(`  node outbound-call.js --status ${result.call_id}`);
    return result;
  } else {
    console.error('❌ Call failed:', result);
    return null;
  }
}

async function getCallStatus(callId) {
  const response = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
    headers: { 'authorization': BLAND_API_KEY }
  });
  
  const call = await response.json();
  
  console.log('📞 Call Status');
  console.log('==============');
  console.log('Status:', call.status);
  console.log('Duration:', call.call_length, 'minutes');
  console.log('Answered by:', call.answered_by);
  console.log('');
  
  if (call.summary) {
    console.log('📝 Summary:');
    console.log(call.summary);
    console.log('');
  }
  
  if (call.analysis) {
    console.log('📊 Analysis:');
    console.log(JSON.stringify(call.analysis, null, 2));
    console.log('');
  }
  
  if (call.transcripts && call.transcripts.length > 0) {
    console.log('🎙️ Transcript:');
    for (const t of call.transcripts) {
      const speaker = t.user === 'assistant' ? 'SEVYN' : 'CALLER';
      console.log(`[${speaker}]: ${t.text}`);
    }
  } else if (call.concatenated_transcript) {
    console.log('🎙️ Transcript:');
    console.log(call.concatenated_transcript);
  }
  
  if (call.recording_url) {
    console.log('');
    console.log('🔊 Recording:', call.recording_url);
  }
  
  return call;
}

async function listRecentCalls(limit = 10) {
  const response = await fetch(`https://api.bland.ai/v1/calls?limit=${limit}`, {
    headers: { 'authorization': BLAND_API_KEY }
  });
  
  const data = await response.json();
  
  console.log('📞 Recent Calls');
  console.log('===============');
  for (const call of data.calls || []) {
    const date = new Date(call.created_at).toLocaleString();
    const duration = call.call_length ? `${call.call_length.toFixed(1)}m` : 'N/A';
    console.log(`${date} | ${call.to} | ${call.status} | ${duration} | ID: ${call.call_id}`);
  }
  
  return data.calls;
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--list') || args.includes('-l')) {
  listRecentCalls();
} else if (args.includes('--status') || args.includes('-s')) {
  const idx = args.indexOf('--status') !== -1 ? args.indexOf('--status') : args.indexOf('-s');
  const callId = args[idx + 1];
  if (callId) {
    getCallStatus(callId);
  } else {
    console.log('Usage: node outbound-call.js --status <call_id>');
  }
} else if (args.length >= 2) {
  const phone = args[0];
  const task = args[1];
  makeCall(phone, task);
} else if (args.length === 0) {
  console.log(`
Sevyn Outbound Call System
==========================

Usage:
  node outbound-call.js <phone> "<task>"     Make a call
  node outbound-call.js --status <call_id>   Get call transcript
  node outbound-call.js --list               List recent calls

Examples:
  node outbound-call.js +12087154601 "Ask Fred about the $4000 payment and G-1450 form"
  node outbound-call.js --status abc123-def456
  `);
}

module.exports = { makeCall, getCallStatus, listRecentCalls };
