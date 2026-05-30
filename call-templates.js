#!/usr/bin/env node
/**
 * Pre-built call templates for common scenarios
 * Usage: node call-templates.js <template> <phone> [name] [details]
 */

const { makeCall } = require('./outbound-call.js');

const TEMPLATES = {
  // Payment follow-up
  payment: (name, amount, caseType) => ({
    task: `You need to speak with ${name || 'the client'}. Your goals: 
      1) Politely follow up on the outstanding payment of ${amount || 'the balance'}
      2) Ask when they can make the payment (wire transfer or credit card)
      3) Mention we need payment to proceed with their ${caseType || 'visa'} case
      4) Be professional but direct - we need this resolved today if possible
      5) If they have concerns, listen and note them`,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. May I speak with ${name || 'the person handling the visa case'}?`
  }),

  // Document signature follow-up
  documents: (name, docs) => ({
    task: `You need to speak with ${name || 'the client'}. Your goals:
      1) Follow up on documents that need to be signed: ${docs || 'I-129 petition and related forms'}
      2) Ask when they can sign and return the documents
      3) Explain we can send the documents again if needed
      4) Emphasize we file immediately once we receive signed docs
      5) Offer to answer any questions about the documents`,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. Am I speaking with ${name}?`
  }),

  // G-1450 credit card form
  g1450: (name, amount) => ({
    task: `You need to speak with ${name || 'the client'}. Your goals:
      1) Explain we need the G-1450 credit card authorization form for USCIS filing fees
      2) The amount is ${amount || '$2,805 for standard or $3,860 with premium processing'}
      3) This is paid directly to USCIS via credit card - not to our firm
      4) Ask if they can fill out and return the form today
      5) Offer to resend the form if they need it`,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. May I speak with ${name}?`
  }),

  // Full case follow-up (payment + docs + G-1450)
  fullFollowup: (name, amount, caseType) => ({
    task: `You need to speak with ${name || 'the client'}. This is a complete case follow-up. Your goals:
      1) Confirm when the ${amount || 'outstanding balance'} attorney fee will be paid
      2) We need the G-1450 credit card form filled out for USCIS fees
      3) We need signatures on the I-129 petition and any addendum pages
      4) Emphasize: once payment clears and docs are signed, we file immediately
      5) Ask if they have any questions or concerns
      Be professional, friendly, but direct - this ${caseType || 'visa case'} is ready to file.`,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. Am I speaking with ${name}?`
  }),

  // Consultation follow-up
  consultation: (name) => ({
    task: `You're following up with ${name || 'a potential client'} who had a consultation with Sherrod. Your goals:
      1) Check if they have any questions after their consultation
      2) Ask if they're ready to move forward with their visa case
      3) If yes, explain next steps: engagement letter and retainer payment
      4) If they have concerns, listen and note them for Sherrod to address
      5) Be helpful and not pushy`,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. Am I speaking with ${name}? I'm following up on your recent consultation.`
  }),

  // Custom call
  custom: (name, customTask) => ({
    task: customTask,
    firstSentence: `Hi, this is Sevyn calling from Sherrod Sports Visas. May I speak with ${name}?`
  })
};

// CLI
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
Sevyn Call Templates
====================

Usage: node call-templates.js <template> <phone> [name] [details]

Templates:
  payment      - Payment follow-up
                 node call-templates.js payment +1234567890 "John Smith" "$4,000" "O-1A"
  
  documents    - Document signature follow-up
                 node call-templates.js documents +1234567890 "John Smith" "I-129 and G-1450"
  
  g1450        - G-1450 credit card form
                 node call-templates.js g1450 +1234567890 "John Smith" "$3,860"
  
  fullFollowup - Full case follow-up (payment + docs + G-1450)
                 node call-templates.js fullFollowup +1234567890 "John Smith" "$4,000" "O-1A"
  
  consultation - Post-consultation follow-up
                 node call-templates.js consultation +1234567890 "John Smith"
  
  custom       - Custom task
                 node call-templates.js custom +1234567890 "John Smith" "Your custom task here"
  `);
  process.exit(0);
}

const [template, phone, name, detail1, detail2] = args;

if (!TEMPLATES[template]) {
  console.error(`Unknown template: ${template}`);
  console.log('Available templates:', Object.keys(TEMPLATES).join(', '));
  process.exit(1);
}

const config = TEMPLATES[template](name, detail1, detail2);
makeCall(phone, config.task, { firstSentence: config.firstSentence });
