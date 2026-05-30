/**
 * Inbound Voice Handler - Conversational AI
 * Uses Bland.ai to have intelligent conversations on incoming calls
 * 
 * OPERATIONS MODE (March 2026):
 * - Phone is for NEW BUSINESS DEVELOPMENT only
 * - Existing clients directed to email
 * - 1-3 business day email response time
 * - Clear scripts for handling pushback
 */

const fs = require('fs');
const path = require('path');
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const { detectLanguageFromPhone, getLanguageConfig } = require('./language-detect');

// Load operations mode prompts from files
function loadOpsPrompt(brandKey) {
  const opsFile = path.join(__dirname, 'prompts', `${brandKey}-ops-mode.txt`);
  const fallbackFile = path.join(__dirname, 'prompts', `${brandKey}-enhanced.txt`);
  
  try {
    if (fs.existsSync(opsFile)) {
      console.log(`   📋 Loaded ops-mode prompt for ${brandKey}`);
      return fs.readFileSync(opsFile, 'utf8');
    } else if (fs.existsSync(fallbackFile)) {
      console.log(`   📋 Loaded enhanced prompt for ${brandKey} (no ops-mode)`);
      return fs.readFileSync(fallbackFile, 'utf8');
    }
  } catch (err) {
    console.error(`Error loading prompt for ${brandKey}:`, err);
  }
  return null;
}

// Brand configurations - each number has its own personality
// Adriana = customer-facing AI for all business brands
// Sevyn = personal assistant (internal use only)
// 
// OPERATIONS MODE (March 2026): 
// - Phone is for NEW BUSINESS DEVELOPMENT only
// - Existing clients directed to email
// - Prompts loaded from prompts/*-ops-mode.txt files
// - 1-3 business day email response time
const BRAND_CONFIG = {
  // Sherrod Sports Visas
  '+13108791273': {
    brand: 'SSV',
    brandKey: 'ssv',
    name: 'Sherrod Sports Visas',
    voice: 'colombiana',
    email: 'gabriella@sherrodsportsvisas.com',
    greeting: "Thank you for calling Sherrod Sports Visas! This is Ahdriana, how can I help you today?"
  },

  // Aventus Visa Agents
  '+14696297468': {
    brand: 'Aventus',
    brandKey: 'aventus',
    name: 'Aventus Visa Agents',
    voice: 'colombiana',
    email: 'info@aventusvisaagents.com',
    greeting: "Welcome to Aventus Visa Agents! This is Ahdriana, how may I assist you?"
  },

  // O1dMatch
  '+15617944621': {
    brand: 'O1dMatch',
    brandKey: 'o1dmatch',
    name: 'O1dMatch',
    voice: 'colombiana',
    email: 'info@o1dmatch.com',
    greeting: "Thanks for calling O1dMatch! I'm Ahdriana. Are you looking to check your O-1 visa eligibility?"
  },

  // IGTA
  '+15617869628': {
    brand: 'IGTA',
    brandKey: 'igta',
    name: 'Innovative Global Talent Agency',
    voice: 'colombiana',
    email: 'gabriella@innovativeglobaltalent.com',
    greeting: "You've reached Innovative Global Talent Agency! I'm Ahdriana. How can I help you today?"
  },

  // DC Federal Litigation
  '+12029993631': {
    brand: 'DC Federal',
    brandKey: 'dcfederal',
    name: 'DC Federal Litigation PLLC',
    voice: 'colombiana',
    email: 'info@dcfederallitigation.com',
    greeting: "DC Federal Litigation PLLC, this is Ahdriana speaking. How may I direct your call?"
  },

  // O1DMatch Sales Training line
  '+19803032854': {
    brand: 'Sevyn',
    brandKey: 'sevyn',
    name: 'O1DMatch Sales Training',
    voice: 'nat',
    email: 'info@o1dmatch.com',
    greeting: "Hey! I'm Sevyn — the AI you need to convince. This is a live sales evaluation for O1DMatch. Treat me like a real prospect, give me your best pitch, and I'll give you scored feedback at the end. You'll know the evaluation is over when I say 'Alright, time's up — let me give you your score.' Let's see what you got."
  },

  // Twilio routing number
  '+19804092695': {
    brand: 'General',
    brandKey: 'sevyn',
    name: 'Sevyn Stark',
    voice: 'nat',
    email: 'gabriella@sherrodsportsvisas.com',
    greeting: "Hi, this is Sevyn! How can I help you today?"
  }
};

// VIP contacts - route these differently
const VIP_CONTACTS = {
  '+16143307116': { name: 'Rollin Seward', relation: 'father', action: 'priority' },
  '+15617408303': { name: 'Sherrod Seward', relation: 'boss', action: 'priority' },
  '+19562249376': { name: 'Gabby Terico', relation: 'team', action: 'priority' },
  '+16824083601': { name: 'Chayla Moore', relation: 'team', action: 'normal' }
};

/**
 * Get brand config for a phone number
 */
function getBrandConfig(phoneNumber) {
  const normalized = phoneNumber?.replace(/[^\d+]/g, '') || '';
  const withPlus = normalized.startsWith('+') ? normalized : '+' + normalized;
  return BRAND_CONFIG[withPlus] || BRAND_CONFIG['+19803032854']; // Default to Sevyn
}

/**
 * Check if caller is VIP
 */
function getVIPStatus(callerNumber) {
  const normalized = callerNumber?.replace(/[^\d+]/g, '') || '';
  const withPlus = normalized.startsWith('+') ? normalized : '+' + normalized;
  return VIP_CONTACTS[withPlus] || null;
}

/**
 * Create a Bland.ai call for inbound handling
 * OPERATIONS MODE: Loads prompts from files that direct existing clients to email
 */
async function createInboundAICall(callerNumber, calledNumber, options = {}) {
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  const detectedLang = detectLanguageFromPhone(callerNumber);
  
  // Use detected language unless it's a VIP (VIPs get English)
  const useLang = (vip || detectedLang.code === 'en') ? null : detectedLang;
  
  // Load prompt from file (operations mode)
  let prompt = loadOpsPrompt(brand.brandKey);
  if (!prompt) {
    // Fallback if file not found
    prompt = `You are ${brand.name}'s AI receptionist.

OPERATIONS MODE: Phone is for new business only.
- Existing clients: Direct to email at ${brand.email}
- Response time: 1-3 business days
- Take messages for new leads, explain email follow-up

Be warm and professional. Collect: name, email, profession for new leads.`;
    console.log(`   ⚠️ Using fallback prompt for ${brand.brandKey}`);
  }
  
  // Modify prompt for VIP callers
  if (vip) {
    prompt = `IMPORTANT: This caller is ${vip.name} (${vip.relation}). Greet them by name and be extra helpful. For VIPs, you can be more flexible - but still encourage email for tracking purposes.\n\n${prompt}`;
  }
  
  // Add language instruction if non-English
  if (useLang && useLang.code !== 'en') {
    prompt = `LANGUAGE: Speak in ${useLang.name}. The caller appears to be from a ${useLang.name}-speaking region.\n\n${prompt}`;
    console.log(`   🌍 Auto-detected language: ${useLang.name}`);
  }
  
  const callConfig = {
    phone_number: callerNumber,
    from: calledNumber,
    voice: useLang?.voice || brand.voice,
    language: useLang?.code || 'en',
    first_sentence: vip 
      ? `Hey ${vip.name.split(' ')[0]}! Great to hear from you. What can I do for you?`
      : (useLang?.greeting || brand.greeting),
    task: prompt,
    model: "enhanced",
    temperature: 0.7,
    max_duration: 15,
    record: true,
    wait_for_greeting: true,
    interruption_threshold: 100,
    webhook: options.webhookUrl || process.env.WEBHOOK_URL || null,
    analysis_schema: {
      caller_name: "string - the caller's full name if provided",
      caller_email: "string - the caller's email if provided",
      caller_phone: "string - callback number if different from caller ID",
      caller_type: "string - 'new_lead', 'existing_client', 'vendor', 'personal', or 'unknown'",
      inquiry_topic: "string - what they're calling about",
      urgency: "string - 'urgent', 'normal', or 'low'",
      outcome: "string - 'directed_to_email', 'lead_captured', 'message_taken', 'transferred', or 'other'",
      follow_up_needed: "boolean - whether someone needs to follow up by email",
      directed_to_email: "boolean - whether caller was told to email for support",
      notes: "string - any other important details from the call"
    },
    metadata: {
      brand: brand.brand,
      brand_name: brand.name,
      brand_email: brand.email,
      caller_number: callerNumber,
      called_number: calledNumber,
      is_vip: !!vip,
      vip_name: vip?.name || null,
      operations_mode: true,
      timestamp: new Date().toISOString()
    }
  };

  console.log(`📞 Creating AI call for ${brand.brand} (OPS MODE) - Caller: ${callerNumber}`);
  console.log(`   📧 Email for support: ${brand.email}`);
  if (vip) console.log(`   ⭐ VIP: ${vip.name} (${vip.relation})`);

  try {
    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': BLAND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(callConfig)
    });

    const result = await response.json();
    
    if (result.call_id) {
      console.log(`   ✅ Call initiated: ${result.call_id}`);
    } else {
      console.error(`   ❌ Call failed:`, result);
    }
    
    return result;
  } catch (error) {
    console.error('Bland.ai API error:', error);
    throw error;
  }
}

/**
 * Express handler for inbound voice (Twilio webhook)
 * Strategy: Use TwiML to connect caller to a conference, then have Bland.ai join
 */
function handleInboundVoice(req, res) {
  const twilio = require('twilio');
  const callerNumber = req.body.From;
  const calledNumber = req.body.Called || req.body.To;
  const callSid = req.body.CallSid;
  
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  
  console.log(`\n📞 INBOUND CALL`);
  console.log(`   From: ${callerNumber}${vip ? ` (VIP: ${vip.name})` : ''}`);
  console.log(`   To: ${calledNumber} (${brand.brand})`);
  console.log(`   CallSid: ${callSid}`);

  const twiml = new twilio.twiml.VoiceResponse();
  
  // Play a brief hold message while we connect Bland.ai
  twiml.say({ voice: 'Polly.Joanna' }, brand.greeting);
  twiml.pause({ length: 1 });
  
  // Create a unique conference for this call
  const conferenceName = `sevyn-${callSid}`;
  
  // Put caller in conference
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true,
    waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock',
    statusCallback: `${process.env.BASE_URL || 'https://your-url.com'}/conference-status`,
    statusCallbackEvent: ['start', 'end', 'join', 'leave']
  }, conferenceName);

  // Trigger Bland.ai to join the conference (async)
  setImmediate(async () => {
    try {
      // Small delay to ensure conference is ready
      await new Promise(r => setTimeout(r, 2000));
      
      // Have Bland.ai call into the conference
      await createInboundAICall(callerNumber, calledNumber, {
        webhookUrl: `${process.env.BASE_URL || 'https://your-url.com'}/call-complete`
      });
    } catch (error) {
      console.error('Failed to connect Bland.ai:', error);
    }
  });

  res.type('text/xml');
  res.send(twiml.toString());
}

/**
 * Simple direct approach - just have Bland call them back immediately
 * This is simpler and works reliably
 */
async function handleInboundSimple(req, res) {
  const twilio = require('twilio');
  const callerNumber = req.body.From;
  const calledNumber = req.body.Called || req.body.To;
  
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  
  console.log(`\n📞 INBOUND CALL (Simple Mode)`);
  console.log(`   From: ${callerNumber}${vip ? ` (VIP: ${vip.name})` : ''}`);
  console.log(`   To: ${calledNumber} (${brand.brand})`);

  // Send TwiML to hold the caller briefly
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'One moment please while I connect you.');
  twiml.pause({ length: 1 });
  
  // Redirect to Bland.ai's phone number with SIP or just forward
  // For now, we'll use the direct approach - Bland calls them back
  twiml.say({ voice: 'Polly.Joanna' }, "I'll call you right back on this number. Please stay by your phone.");
  twiml.hangup();

  // Trigger Bland.ai callback
  setImmediate(async () => {
    try {
      await new Promise(r => setTimeout(r, 1000));
      await createInboundAICall(callerNumber, calledNumber, {
        webhookUrl: `${process.env.BASE_URL}/call-complete`
      });
    } catch (error) {
      console.error('Failed to initiate Bland.ai callback:', error);
    }
  });

  res.type('text/xml');
  res.send(twiml.toString());
}

/**
 * Transfer approach - forward directly to Bland.ai's conversational number
 */
function handleInboundTransfer(req, res) {
  const twilio = require('twilio');
  const calledNumber = req.body.Called || req.body.To;
  const callerNumber = req.body.From;
  
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  
  console.log(`\n📞 INBOUND CALL (Transfer Mode)`);
  console.log(`   From: ${callerNumber}${vip ? ` (VIP: ${vip.name})` : ''}`);
  console.log(`   To: ${calledNumber} (${brand.brand})`);

  const twiml = new twilio.twiml.VoiceResponse();
  
  // Brief greeting
  twiml.say({ voice: 'Polly.Joanna' }, brand.greeting.split('!')[0] + '!');
  twiml.pause({ length: 1 });
  
  // Forward to Bland.ai agent phone (if set up)
  // You'd need to configure a Bland.ai inbound number for this
  const blandInboundNumber = '+19803502728'; // Bland's current number
  
  twiml.dial({ 
    timeout: 30,
    callerId: calledNumber,
    action: `${process.env.BASE_URL || ''}/voice-complete`
  }, blandInboundNumber);

  res.type('text/xml');
  res.send(twiml.toString());
}

module.exports = {
  handleInboundVoice,
  handleInboundSimple,
  handleInboundTransfer,
  createInboundAICall,
  getBrandConfig,
  getVIPStatus,
  loadOpsPrompt,
  BRAND_CONFIG,
  VIP_CONTACTS
};
