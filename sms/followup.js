/**
 * Auto-SMS Follow-up after calls
 * Sends intake form link and thank you message
 */

const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Brand-specific SMS templates and intake forms
const BRAND_FOLLOWUP = {
  'SSV': {
    from: '+19803032854', // Sevyn number
    intakeForm: 'sherrodsportsvisas.report',
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling Sherrod Sports Visas.

To get started on your visa case, please complete our intake form:
→ ${BRAND_FOLLOWUP['SSV'].intakeForm}

We'll review your info and follow up within 24 hours.

- Adriana, SSV Team`
  },
  
  'Aventus': {
    from: '+19803032854',
    intakeForm: 'aventusvisaagents.online/intake',
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling Aventus Visa Agents.

Complete your intake form to get started:
→ ${BRAND_FOLLOWUP['Aventus'].intakeForm}

We'll review and follow up within 24 hours.

- Adriana, Aventus Team`
  },
  
  'O1dMatch': {
    from: '+19803032854',
    intakeForm: 'o1dmatch.com',
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling O1dMatch.

Take our FREE AI eligibility assessment:
→ ${BRAND_FOLLOWUP['O1dMatch'].intakeForm}

Find out if you qualify for an O-1 visa in minutes!

- Adriana, O1dMatch`
  },
  
  'IGTA': {
    from: '+19803032854',
    intakeForm: 'oandpvisas.community',
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling IGTA.

Start your visa journey here:
→ ${BRAND_FOLLOWUP['IGTA'].intakeForm}

Or book a consultation:
→ igtaconsultation.tinysite.com

- Adriana, IGTA Team`
  },
  
  'DC Federal': {
    from: '+19803032854',
    intakeForm: null, // No intake form, attorney will call
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling DC Federal Litigation.

An attorney will review your case and contact you within 48 hours.

If urgent, email: info@dcfederallitigation.com

- Adriana, DC Federal Litigation`
  },
  
  'Sevyn': {
    from: '+19803032854',
    intakeForm: 'oandpvisas.community',
    message: (name) => `Hi${name ? ` ${name}` : ''}! Thanks for calling.

To get started, complete our intake form:
→ ${BRAND_FOLLOWUP['Sevyn'].intakeForm}

We'll be in touch soon!

- Adriana`
  }
};

/**
 * Send follow-up SMS after a call
 * @param {Object} options - Call details
 * @param {string} options.brand - Brand that received the call
 * @param {string} options.callerPhone - Caller's phone number
 * @param {string} options.callerName - Caller's name (if collected)
 * @param {string} options.callerType - Type of caller (new_lead, existing_client, etc.)
 */
async function sendFollowupSMS({ brand, callerPhone, callerName, callerType }) {
  // Don't send to existing clients (they already know the process)
  if (callerType === 'existing_client') {
    console.log(`   ⏭️ Skipping follow-up SMS for existing client`);
    return { sent: false, reason: 'existing_client' };
  }
  
  // Validate phone number
  if (!callerPhone || callerPhone.length < 10) {
    console.log(`   ⏭️ Skipping follow-up SMS - invalid phone`);
    return { sent: false, reason: 'invalid_phone' };
  }
  
  // Get brand config
  const config = BRAND_FOLLOWUP[brand] || BRAND_FOLLOWUP['Sevyn'];
  
  // Format first name only
  const firstName = callerName ? callerName.split(' ')[0] : null;
  
  // Generate message
  const message = config.message(firstName);
  
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: config.from,
      to: callerPhone
    });
    
    console.log(`   📱 Follow-up SMS sent to ${callerPhone} (SID: ${result.sid})`);
    
    return {
      sent: true,
      sid: result.sid,
      to: callerPhone,
      brand: brand
    };
  } catch (error) {
    console.error(`   ❌ Failed to send follow-up SMS: ${error.message}`);
    return {
      sent: false,
      reason: error.message
    };
  }
}

module.exports = {
  sendFollowupSMS,
  BRAND_FOLLOWUP
};
