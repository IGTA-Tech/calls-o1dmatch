/**
 * Push prompt files to Retell LLMs.
 * For Vapi, run scripts/provision-vapi.js instead — it updates assistants
 * in-place when re-run, pulling the latest prompt files.
 */
const fs = require('fs');

require('dotenv').config();
const RETELL_API_KEY = process.env.RETELL_API_KEY;

const AGENTS = [
  { name: 'SSV', llmId: 'llm_ad6c7759ae01a92b1f4d05059c97', promptFile: 'prompts/ssv-enhanced.txt' },
  { name: 'Aventus', llmId: 'llm_a781863748d3db7a65856dab1ba6', promptFile: 'prompts/aventus-enhanced.txt' },
  { name: 'O1dMatch', llmId: 'llm_52363e06e376d4bb881332c3d32a', promptFile: 'prompts/o1dmatch-enhanced.txt' },
  { name: 'IGTA', llmId: 'llm_7a79585d0caac1da860ce480e18d', promptFile: 'prompts/igta-enhanced.txt' },
  { name: 'DC Federal', llmId: 'llm_8149efa553fc1cb99c9330f7c449', promptFile: 'prompts/dcfederal-enhanced.txt' },
  { name: 'Sevyn', llmId: 'llm_9c4f492c5e96a714aec0feab1d5d', promptFile: 'prompts/sevyn-sales-training.txt', beginMessage: "Hey! I'm Sevyn — the AI you need to convince. This is a live sales evaluation for O1DMatch. Treat me like a real prospect, give me your best pitch, and I'll give you scored feedback at the end. You'll know the evaluation is over when I say 'Alright, time's up — let me give you your score.' Let's see what you got." }
];

function loadPronunciation() {
  try { return fs.readFileSync('prompts/_pronunciation.txt', 'utf8'); }
  catch { return ''; }
}

async function updateLLM(agent) {
  const prompt = loadPronunciation() + fs.readFileSync(agent.promptFile, 'utf8');
  
  const response = await fetch(`https://api.retellai.com/update-retell-llm/${agent.llmId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${RETELL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      general_prompt: prompt,
      ...(agent.beginMessage && { begin_message: agent.beginMessage })
    })
  });
  
  if (response.ok) {
    console.log(`✅ ${agent.name} - Updated`);
  } else {
    const err = await response.text();
    console.log(`❌ ${agent.name} - Failed: ${err}`);
  }
}

async function main() {
  console.log('Updating agent prompts...\n');
  for (const agent of AGENTS) {
    await updateLLM(agent);
  }
  console.log('\nDone!');
}

main();
