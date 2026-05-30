/**
 * Language Auto-Detection
 * Detects caller's language from phone number country code or speech
 */

// Country code to language mapping
const COUNTRY_TO_LANGUAGE = {
  // North America (English default)
  '+1': 'en',
  
  // Latin America (Spanish)
  '+52': 'es',  // Mexico
  '+54': 'es',  // Argentina
  '+55': 'pt',  // Brazil (Portuguese)
  '+56': 'es',  // Chile
  '+57': 'es',  // Colombia
  '+58': 'es',  // Venezuela
  '+51': 'es',  // Peru
  '+593': 'es', // Ecuador
  '+591': 'es', // Bolivia
  '+595': 'es', // Paraguay
  '+598': 'es', // Uruguay
  '+507': 'es', // Panama
  '+506': 'es', // Costa Rica
  '+503': 'es', // El Salvador
  '+502': 'es', // Guatemala
  '+504': 'es', // Honduras
  '+505': 'es', // Nicaragua
  '+53': 'es',  // Cuba
  '+1809': 'es', // Dominican Republic
  '+1829': 'es',
  '+1849': 'es',
  
  // Europe
  '+44': 'en',  // UK
  '+33': 'fr',  // France
  '+34': 'es',  // Spain
  '+49': 'de',  // Germany
  '+39': 'it',  // Italy
  '+31': 'nl',  // Netherlands
  '+351': 'pt', // Portugal
  '+32': 'fr',  // Belgium (French default)
  '+41': 'de',  // Switzerland (German default)
  '+43': 'de',  // Austria
  '+353': 'en', // Ireland
  '+48': 'en',  // Poland (fallback English)
  '+380': 'en', // Ukraine
  '+7': 'en',   // Russia (fallback English)
  
  // Asia
  '+81': 'ja',  // Japan
  '+86': 'zh',  // China
  '+82': 'ko',  // South Korea
  '+91': 'en',  // India (English)
  '+63': 'en',  // Philippines
  '+65': 'en',  // Singapore
  '+852': 'zh', // Hong Kong
  '+886': 'zh', // Taiwan
  '+66': 'en',  // Thailand
  '+84': 'en',  // Vietnam
  
  // Middle East / Africa
  '+971': 'en', // UAE
  '+966': 'en', // Saudi Arabia
  '+972': 'en', // Israel
  '+27': 'en',  // South Africa
  '+234': 'en', // Nigeria
  '+254': 'en', // Kenya
  
  // Oceania
  '+61': 'en',  // Australia
  '+64': 'en',  // New Zealand
};

// Language configurations with voice IDs
const LANGUAGE_CONFIG = {
  'en': {
    code: 'en',
    name: 'English',
    voice: 'nat',
    greeting: "Hi, this is Sevyn. How can I help you today?"
  },
  'es': {
    code: 'es',
    name: 'Spanish',
    voice: 'paola', // Spanish voice
    greeting: "Hola, soy Sevyn. ¿En qué puedo ayudarte hoy?"
  },
  'pt': {
    code: 'pt',
    name: 'Portuguese',
    voice: 'camila', // Portuguese voice
    greeting: "Olá, sou Sevyn. Como posso ajudá-lo hoje?"
  },
  'fr': {
    code: 'fr',
    name: 'French',
    voice: 'lea', // French voice
    greeting: "Bonjour, je suis Sevyn. Comment puis-je vous aider?"
  },
  'de': {
    code: 'de',
    name: 'German',
    voice: 'vicki', // German voice
    greeting: "Hallo, hier ist Sevyn. Wie kann ich Ihnen helfen?"
  },
  'it': {
    code: 'it',
    name: 'Italian',
    voice: 'carla', // Italian voice
    greeting: "Ciao, sono Sevyn. Come posso aiutarti?"
  },
  'ja': {
    code: 'ja',
    name: 'Japanese',
    voice: 'mizuki', // Japanese voice
    greeting: "こんにちは、セブンです。ご用件をお伺いします。"
  },
  'zh': {
    code: 'zh',
    name: 'Chinese',
    voice: 'zhiyu', // Chinese voice
    greeting: "您好，我是Sevyn。有什么可以帮您的？"
  },
  'ko': {
    code: 'ko',
    name: 'Korean',
    voice: 'seoyeon', // Korean voice
    greeting: "안녕하세요, 세븐입니다. 무엇을 도와드릴까요?"
  },
  'nl': {
    code: 'nl',
    name: 'Dutch',
    voice: 'lotte', // Dutch voice
    greeting: "Hallo, met Sevyn. Hoe kan ik u helpen?"
  }
};

/**
 * Detect language from phone number
 */
function detectLanguageFromPhone(phoneNumber) {
  if (!phoneNumber) return LANGUAGE_CONFIG['en'];
  
  const normalized = phoneNumber.replace(/[^\d+]/g, '');
  const withPlus = normalized.startsWith('+') ? normalized : '+' + normalized;
  
  // Try to match country codes (longest first)
  const sortedCodes = Object.keys(COUNTRY_TO_LANGUAGE).sort((a, b) => b.length - a.length);
  
  for (const code of sortedCodes) {
    if (withPlus.startsWith(code)) {
      const langCode = COUNTRY_TO_LANGUAGE[code];
      console.log(`🌍 Detected language ${langCode} from ${code}`);
      return LANGUAGE_CONFIG[langCode] || LANGUAGE_CONFIG['en'];
    }
  }
  
  return LANGUAGE_CONFIG['en']; // Default to English
}

/**
 * Get language config by code
 */
function getLanguageConfig(langCode) {
  return LANGUAGE_CONFIG[langCode] || LANGUAGE_CONFIG['en'];
}

/**
 * Parse language from Bland.ai analysis or user request
 */
function parseLanguageRequest(text) {
  if (!text) return null;
  
  const lower = text.toLowerCase();
  
  const patterns = {
    'es': ['spanish', 'español', 'espanol', 'habla español', 'en español'],
    'pt': ['portuguese', 'português', 'portugues', 'em português'],
    'fr': ['french', 'français', 'francais', 'en français'],
    'de': ['german', 'deutsch', 'auf deutsch'],
    'it': ['italian', 'italiano', 'in italiano'],
    'ja': ['japanese', '日本語', 'nihongo'],
    'zh': ['chinese', '中文', 'mandarin', 'cantonese'],
    'ko': ['korean', '한국어', 'hangugeo'],
    'nl': ['dutch', 'nederlands']
  };
  
  for (const [code, keywords] of Object.entries(patterns)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return LANGUAGE_CONFIG[code];
    }
  }
  
  return null;
}

/**
 * Get all supported languages
 */
function getSupportedLanguages() {
  return Object.values(LANGUAGE_CONFIG).map(l => ({
    code: l.code,
    name: l.name
  }));
}

module.exports = {
  detectLanguageFromPhone,
  getLanguageConfig,
  parseLanguageRequest,
  getSupportedLanguages,
  LANGUAGE_CONFIG,
  COUNTRY_TO_LANGUAGE
};

// CLI test
if (require.main === module) {
  const testNumbers = [
    '+15617408303',  // US
    '+5215512345678', // Mexico
    '+5521999999999', // Brazil
    '+33612345678',   // France
    '+819012345678',  // Japan
    '+8613812345678', // China
  ];
  
  console.log('Language Detection Test:\n');
  testNumbers.forEach(num => {
    const lang = detectLanguageFromPhone(num);
    console.log(`${num} → ${lang.name} (${lang.code})`);
  });
}
