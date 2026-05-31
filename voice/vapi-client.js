/**
 * Vapi AI Client
 * Mirrors the interface of retell-client.js so the provider can be swapped
 * via the VOICE_PROVIDER env var. Uses Vapi's REST API for assistant CRUD,
 * outbound calls, and Twilio phone-number registration.
 *
 * Brand configs and prompts are shared with the Retell path (loaded from
 * prompts/*.txt). Voice = 11labs Rachel for Adriana brands, separate ID for
 * Sevyn so the sales-training character sounds distinct.
 */

const fs = require('fs');
const path = require('path');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_API_URL = 'https://api.vapi.ai';

// 11labs voice IDs
const VOICE_RACHEL = '21m00Tcm4TlvDq8ikWAM';   // warm female — Adriana
const VOICE_BELLA  = 'EXAVITQu4vr4xnSDxMaL';   // young female — Sevyn (sales training prospect)

const PROMPT_FILES = {
  '+15617944621': 'o1dmatch-enhanced.txt',
  '+19803032854': 'sevyn-sales-training.txt'
};

function loadPronunciation() {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'prompts', '_pronunciation.txt'), 'utf8');
  } catch {
    return '';
  }
}

function loadPrompt(brandPhone) {
  const file = PROMPT_FILES[brandPhone];
  if (!file) return '';
  try {
    const body = fs.readFileSync(path.join(__dirname, '..', 'prompts', file), 'utf8');
    return loadPronunciation() + body;
  } catch {
    return '';
  }
}

const BRAND_CONFIGS = {
  '+15617944621': {
    brand: 'O1dMatch',
    name: 'O1dMatch',
    agent_name: 'Adriana',
    voice_id: VOICE_RACHEL,
    greeting: "Thanks for calling O1dMatch! I'm Adriana — want me to show you how the platform works and help you get started?",
    get prompt() { return loadPrompt('+15617944621'); }
  },
  '+19803032854': {
    brand: 'Sevyn',
    name: 'O1DMatch Sales Training',
    agent_name: 'Adriana',
    voice_id: VOICE_BELLA,
    greeting: "Hi, this is Adriana, your O1DMatch sales-training agent. Before we start — can I get your name, and can you confirm you're here to practice selling O1DMatch?",
    get prompt() { return loadPrompt('+19803032854'); }
  }
};

const DEFAULT_CONFIG = {
  brand: 'O1dMatch',
  name: 'O1dMatch',
  agent_name: 'Adriana',
  voice_id: VOICE_RACHEL,
  greeting: "Thanks for calling O1dMatch! I'm Adriana. How can I help?",
  get prompt() { return loadPrompt('+15617944621'); }
};

const BRAND_PHONES = {
  'O1dMatch': '+15617944621',
  'Sevyn': '+19803032854'
};

function getBrandConfig(input) {
  if (!input) return DEFAULT_CONFIG;
  if (BRAND_PHONES[input]) {
    const phone = BRAND_PHONES[input];
    const config = BRAND_CONFIGS[phone];
    if (config) return { ...config, prompt: config.prompt, phone };
  }
  const normalized = input.replace(/[^\d+]/g, '') || '';
  const withPlus = normalized.startsWith('+') ? normalized : '+' + normalized;
  const config = BRAND_CONFIGS[withPlus];
  if (config) return { ...config, prompt: config.prompt, phone: withPlus };
  return { ...DEFAULT_CONFIG, prompt: DEFAULT_CONFIG.prompt, phone: '+15617944621' };
}

async function vapiRequest(method, endpoint, body) {
  const response = await fetch(`${VAPI_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const msg = data.message || data.error || JSON.stringify(data);
    throw new Error(`Vapi API ${response.status}: ${msg}`);
  }
  return data;
}

function buildAssistantPayload(brandConfig, webhookUrl) {
  return {
    name: `${brandConfig.brand} - ${brandConfig.agent_name}`,
    firstMessage: brandConfig.greeting,
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [{ role: 'system', content: brandConfig.prompt }]
    },
    voice: {
      provider: '11labs',
      voiceId: brandConfig.voice_id,
      model: 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.75
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en'
    },
    serverUrl: webhookUrl,
    // Explicit event subscription — without this, Vapi sometimes uses
    // defaults that omit end-of-call-report (where transcript/summary live).
    serverMessages: ['status-update', 'end-of-call-report', 'hang', 'transcript'],
    endCallFunctionEnabled: true,
    recordingEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    backgroundSound: 'office',
    analysisPlan: {
      summaryPrompt: 'Summarize this call in 2-3 sentences focused on the caller\'s intent and any commitments made.',
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: 'object',
          properties: {
            caller_name: { type: 'string', description: 'Full name of the caller' },
            caller_email: { type: 'string', description: 'Email if provided' },
            caller_phone: { type: 'string', description: 'Callback number if different' },
            caller_type: { type: 'string', description: 'new_lead, existing_client, or other' },
            inquiry_topic: { type: 'string', description: 'What they are calling about' },
            follow_up_needed: { type: 'boolean', description: 'Whether someone needs to call back' },
            urgency: { type: 'string', description: 'urgent, normal, or low' },
            summary: { type: 'string', description: 'Brief summary of the call' }
          }
        }
      }
    }
  };
}

async function createAssistant(brandConfig, webhookUrl) {
  return vapiRequest('POST', '/assistant', buildAssistantPayload(brandConfig, webhookUrl));
}

async function updateAssistant(assistantId, brandConfig, webhookUrl) {
  return vapiRequest('PATCH', `/assistant/${assistantId}`, buildAssistantPayload(brandConfig, webhookUrl));
}

async function listAssistants() {
  return vapiRequest('GET', '/assistant');
}

async function registerPhoneNumber(twilioNumber, assistantId) {
  return vapiRequest('POST', '/phone-number', {
    provider: 'twilio',
    number: twilioNumber,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    assistantId
  });
}

async function listPhoneNumbers() {
  return vapiRequest('GET', '/phone-number');
}

/**
 * Create an outbound call via Vapi.
 * @param {string} fromNumber - The brand's phone number (must be registered with Vapi).
 * @param {string} toNumber - Destination number.
 * @param {string} assistantId - Optional override; usually the phone number's default is used.
 * @param {object} dynamicVars - { call_direction, custom_task } for prompt variable injection.
 * @param {object} agentOverride - { firstMessage } to override the greeting.
 */
async function createPhoneCall(fromNumber, toNumber, assistantId, dynamicVars = {}, agentOverride = {}) {
  const phoneNumbers = await listPhoneNumbers();
  const phoneRecord = phoneNumbers.find(p => p.number === fromNumber);
  if (!phoneRecord) {
    throw new Error(`Vapi: phone number ${fromNumber} is not registered. Run scripts/provision-vapi.js first.`);
  }

  const body = {
    phoneNumberId: phoneRecord.id,
    customer: { number: toNumber }
  };

  // Vapi requires an explicit assistant ID for outbound calls. Prefer the
  // caller-provided override, otherwise fall back to whichever assistant the
  // phone number was linked to during provisioning.
  const resolvedAssistantId = assistantId || phoneRecord.assistantId;
  if (!resolvedAssistantId) {
    throw new Error(`Vapi: no assistant linked to ${fromNumber}. Re-run scripts/provision-vapi.js.`);
  }
  body.assistantId = resolvedAssistantId;

  // Inject dynamic variables (Vapi uses assistantOverrides.variableValues)
  const overrides = {};
  if (dynamicVars && Object.keys(dynamicVars).length > 0) {
    overrides.variableValues = dynamicVars;
  }
  if (agentOverride && agentOverride.firstMessage) {
    overrides.firstMessage = agentOverride.firstMessage;
  }
  if (Object.keys(overrides).length > 0) {
    body.assistantOverrides = overrides;
  }

  const result = await vapiRequest('POST', '/call', body);
  return { call_id: result.id, ...result };
}

async function getCall(callId) {
  return vapiRequest('GET', `/call/${callId}`);
}

module.exports = {
  BRAND_CONFIGS,
  BRAND_PHONES,
  getBrandConfig,
  createAssistant,
  updateAssistant,
  listAssistants,
  registerPhoneNumber,
  listPhoneNumbers,
  createPhoneCall,
  getCall,
  vapiRequest
};
