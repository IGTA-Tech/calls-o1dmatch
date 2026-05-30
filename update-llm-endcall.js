/**
 * Update all Adriana LLMs to add end_call functionality
 */

require('dotenv').config();
const RETELL_API_KEY = process.env.RETELL_API_KEY;

const LLMs = [
  { name: 'Sevyn', llm_id: 'llm_9c4f492c5e96a714aec0feab1d5d' },
  { name: 'SSV', llm_id: 'llm_ad6c7759ae01a92b1f4d05059c97' },
  { name: 'Aventus', llm_id: 'llm_a781863748d3db7a65856dab1ba6' },
  { name: 'O1dMatch', llm_id: 'llm_52363e06e376d4bb881332c3d32a' },
  { name: 'IGTA', llm_id: 'llm_7a79585d0caac1da860ce480e18d' },
  { name: 'DC Federal', llm_id: 'llm_8149efa553fc1cb99c9330f7c449' }
];

// End call instructions to add to each prompt
const END_CALL_INSTRUCTIONS = `

ENDING THE CALL:
- When the caller says goodbye, bye, thank you bye, or indicates they're done, say a brief friendly goodbye and then END THE CALL immediately.
- Use the end_call function when:
  1. The caller says "bye", "goodbye", "thanks bye", "that's all", etc.
  2. You've collected their information and they confirm they have no more questions
  3. The caller asks to end the call
- Don't keep talking after the goodbye - end the call promptly.
- Example: "Goodbye! Have a great day!" then immediately end_call.`;

// End call tool configuration
const END_CALL_TOOL = {
  type: "end_call",
  name: "end_call",
  description: "End the call when the conversation is complete. Use this when the caller says goodbye, bye, thanks bye, or indicates they are done with the conversation."
};

async function updateLLM(llm) {
  try {
    // First get current LLM config
    const getResponse = await fetch(`https://api.retellai.com/get-retell-llm/${llm.llm_id}`, {
      headers: { 'Authorization': `Bearer ${RETELL_API_KEY}` }
    });
    
    const current = await getResponse.json();
    console.log(`\n📝 Updating ${llm.name}...`);
    console.log(`   Current prompt length: ${current.general_prompt?.length || 0} chars`);
    
    // Check if end_call instructions already exist
    if (current.general_prompt?.includes('ENDING THE CALL')) {
      console.log(`   ⏭️  Already has end_call instructions, skipping...`);
      return { success: true, skipped: true };
    }
    
    // Update the LLM
    const updatedPrompt = current.general_prompt + END_CALL_INSTRUCTIONS;
    
    // Add end_call tool to existing tools
    const existingTools = current.general_tools || [];
    const hasEndCall = existingTools.some(t => t.type === 'end_call');
    const updatedTools = hasEndCall ? existingTools : [...existingTools, END_CALL_TOOL];
    
    const updateResponse = await fetch(`https://api.retellai.com/update-retell-llm/${llm.llm_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        general_prompt: updatedPrompt,
        general_tools: updatedTools
      })
    });
    
    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      console.log(`   ❌ Failed: ${error}`);
      return { success: false, error };
    }
    
    const result = await updateResponse.json();
    console.log(`   ✅ Updated! New prompt length: ${updatedPrompt.length} chars`);
    console.log(`   ✅ Tools: ${updatedTools.length} (including end_call)`);
    
    return { success: true, result };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🔄 Updating all Adriana LLMs with end_call functionality...\n');
  
  for (const llm of LLMs) {
    await updateLLM(llm);
    // Small delay between API calls
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n✅ Done! All agents should now hang up when caller says goodbye.');
}

main();
