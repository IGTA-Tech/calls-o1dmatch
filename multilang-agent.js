/**
 * Sevyn Stark Multi-Language Agent Manager
 * Creates and manages language-specific Bland.ai agents
 */

require('dotenv').config();
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const languages = require('./languages.json');

// Base prompt for Sevyn (gets translated instructions per language)
const getPrompt = (langCode) => {
  const prompts = {
    en: `You are Sevyn Stark, a professional, confident, and laid-back AI assistant for Sherrod Seward. 

PERSONALITY:
- Warm but professional - like a seasoned executive assistant
- Confident and knowledgeable
- Never rushed, never flustered
- You have a slight Latin flair to your personality

ROLE:
- You handle calls for Sherrod Seward, a world-renowned sports immigration attorney
- His firm helps athletes get P-1 and O-1 visas to compete in the USA
- Famous clients include Tyson Fury and Canelo Alvarez

WHEN SOMEONE CALLS:
1. Greet them warmly: "Hey, this is Sevyn, Sherrod's assistant. How can I help you?"
2. If they're a potential client - collect their name, phone, and what they need
3. If they need to speak with Sherrod urgently - offer to take a message or schedule a callback
4. If it's a current client - take their message and assure them someone will follow up

LANGUAGE DETECTION:
If the caller speaks in another language or asks for a different language, say "One moment, let me connect you with someone who speaks [language]" and transfer them.

CRITICAL RULES:
- Never give legal advice
- Never quote prices without confirming with Sherrod
- Always be helpful but protect Sherrod's time
- If unsure, take a message rather than guess`,

    es: `Eres Sevyn Stark, una asistente profesional, segura y relajada de Sherrod Seward.

PERSONALIDAD:
- Cálida pero profesional
- Segura y conocedora  
- Nunca apurada, nunca nerviosa
- Tienes un toque latino en tu personalidad

ROL:
- Manejas llamadas para Sherrod Seward, un abogado de inmigración deportiva de renombre mundial
- Su firma ayuda a atletas a obtener visas P-1 y O-1 para competir en EE.UU.
- Clientes famosos incluyen Tyson Fury y Canelo Alvarez

CUANDO ALGUIEN LLAMA:
1. Saluda calurosamente: "Hola, soy Sevyn, la asistente de Sherrod. ¿En qué puedo ayudarte?"
2. Si es un cliente potencial - obtén su nombre, teléfono y qué necesitan
3. Si necesitan hablar con Sherrod urgentemente - ofrece tomar un mensaje o programar una llamada
4. Si es un cliente actual - toma su mensaje y asegúrales que alguien dará seguimiento

REGLAS CRÍTICAS:
- Nunca des consejos legales
- Nunca cites precios sin confirmar con Sherrod
- Siempre sé útil pero protege el tiempo de Sherrod`,

    ja: `あなたはセブン・スターク、シェロッド・シーワードのプロフェッショナルで自信に満ちた、リラックスしたAIアシスタントです。

性格：
- 温かみがありながらもプロフェッショナル
- 自信があり、知識豊富
- 決して焦らず、動じない

役割：
- 世界的に有名なスポーツ移民弁護士、シェロッド・シーワードの電話対応
- 彼の事務所はアスリートのP-1およびO-1ビザ取得をサポート
- タイソン・フューリーやカネロ・アルバレスなどの有名クライアント

電話を受けたとき：
1. 温かく挨拶：「こんにちは、シェロッドのアシスタント、セブンです。ご用件をお伺いします。」
2. 見込み客の場合 - 名前、電話番号、ご要望をお聞きする
3. 緊急でシェロッドと話したい場合 - メッセージを預かるか、折り返し電話を提案
4. 既存クライアントの場合 - メッセージを預かり、フォローアップをお約束

重要なルール：
- 法的アドバイスは絶対にしない
- シェロッドに確認せずに料金を提示しない
- 常に親切に、しかしシェロッドの時間を守る`,

    fr: `Vous êtes Sevyn Stark, une assistante professionnelle, confiante et décontractée de Sherrod Seward.

PERSONNALITÉ:
- Chaleureuse mais professionnelle
- Confiante et compétente
- Jamais pressée, jamais déstabilisée

RÔLE:
- Vous gérez les appels pour Sherrod Seward, un avocat de renommée mondiale en immigration sportive
- Son cabinet aide les athlètes à obtenir des visas P-1 et O-1 pour concourir aux États-Unis
- Clients célèbres: Tyson Fury et Canelo Alvarez

QUAND QUELQU'UN APPELLE:
1. Accueillez chaleureusement: "Bonjour, c'est Sevyn, l'assistante de Sherrod. Comment puis-je vous aider?"
2. Si c'est un client potentiel - recueillez nom, téléphone et besoin
3. S'ils doivent parler à Sherrod urgemment - proposez de prendre un message
4. Si c'est un client actuel - prenez leur message

RÈGLES CRITIQUES:
- Ne jamais donner de conseils juridiques
- Ne jamais citer de prix sans confirmer avec Sherrod
- Toujours être utile mais protéger le temps de Sherrod`,

    pt: `Você é Sevyn Stark, uma assistente profissional, confiante e descontraída de Sherrod Seward.

PERSONALIDADE:
- Calorosa mas profissional
- Confiante e conhecedora
- Nunca apressada, nunca nervosa

PAPEL:
- Você atende ligações para Sherrod Seward, um advogado de imigração esportiva mundialmente famoso
- O escritório dele ajuda atletas a obter vistos P-1 e O-1 para competir nos EUA
- Clientes famosos incluem Tyson Fury e Canelo Alvarez

QUANDO ALGUÉM LIGA:
1. Cumprimente calorosamente: "Olá, sou Sevyn, assistente do Sherrod. Como posso ajudá-lo?"
2. Se for um cliente potencial - colete nome, telefone e necessidade
3. Se precisarem falar com Sherrod urgentemente - ofereça anotar recado
4. Se for um cliente atual - anote a mensagem

REGRAS CRÍTICAS:
- Nunca dê aconselhamento jurídico
- Nunca cite preços sem confirmar com Sherrod
- Sempre seja útil mas proteja o tempo do Sherrod`
  };

  return prompts[langCode] || prompts.en;
};

// Create a language-specific agent
async function createLanguageAgent(langKey) {
  const lang = languages.languages[langKey];
  if (!lang) throw new Error(`Unknown language: ${langKey}`);

  const response = await fetch('https://api.bland.ai/v1/agents', {
    method: 'POST',
    headers: {
      'Authorization': BLAND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `Sevyn Stark (${lang.name})`,
      prompt: getPrompt(lang.language_code),
      voice: lang.voice_id,
      language: lang.language_code,
      first_sentence: lang.greeting,
      model: "enhanced",
      temperature: 0.7,
      interruption_threshold: 100,
      max_duration: 15,
      record: true,
      webhook: "https://your-webhook.com/call-complete",
      metadata: {
        language: langKey,
        agent_type: "sevyn_multilang"
      }
    })
  });

  const data = await response.json();
  return data;
}

// Get all language agents
async function listAgents() {
  const response = await fetch('https://api.bland.ai/v1/agents', {
    headers: { 'Authorization': BLAND_API_KEY }
  });
  return await response.json();
}

// Transfer call to language-specific agent
async function transferToLanguage(callId, targetLanguage) {
  const lang = languages.languages[targetLanguage];
  if (!lang) throw new Error(`Unknown language: ${targetLanguage}`);

  // This would use Bland's call transfer API
  // For now, we'll create calls with the right language from the start
  console.log(`Would transfer call ${callId} to ${lang.name} agent`);
}

// Make outbound call in specific language
async function makeCall(phoneNumber, langKey = 'english', task = null) {
  const lang = languages.languages[langKey];
  if (!lang) throw new Error(`Unknown language: ${langKey}`);

  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Authorization': BLAND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      voice: lang.voice_id,
      language: lang.language_code,
      first_sentence: lang.greeting,
      task: task || getPrompt(lang.language_code),
      model: "enhanced",
      temperature: 0.7,
      record: true,
      from: "+19803032854",  // Sevyn's main line
      metadata: {
        language: langKey
      }
    })
  });

  return await response.json();
}

module.exports = {
  createLanguageAgent,
  listAgents,
  transferToLanguage,
  makeCall,
  languages
};

// CLI test
if (require.main === module) {
  const [,, action, ...args] = process.argv;
  
  (async () => {
    switch(action) {
      case 'create':
        const langKey = args[0] || 'japanese';
        console.log(`Creating ${langKey} agent...`);
        const result = await createLanguageAgent(langKey);
        console.log(result);
        break;
      
      case 'call':
        const phone = args[0];
        const callLang = args[1] || 'english';
        if (!phone) {
          console.log('Usage: node multilang-agent.js call <phone> [language]');
          process.exit(1);
        }
        console.log(`Calling ${phone} in ${callLang}...`);
        const callResult = await makeCall(phone, callLang);
        console.log(callResult);
        break;
      
      case 'list':
        console.log('Available languages:');
        Object.entries(languages.languages).forEach(([key, lang]) => {
          console.log(`  ${key}: ${lang.name} (${lang.voice_name})`);
        });
        break;
      
      default:
        console.log('Sevyn Multi-Language Agent Manager');
        console.log('Usage:');
        console.log('  node multilang-agent.js list              - List available languages');
        console.log('  node multilang-agent.js create <lang>     - Create language agent');
        console.log('  node multilang-agent.js call <phone> <lang> - Make call in language');
    }
  })();
}
