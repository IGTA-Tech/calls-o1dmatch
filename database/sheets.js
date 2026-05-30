/**
 * Google Sheets Integration for Adriana Multi-Brand System
 * 
 * Master Lead Sheet: 10yzVfq3aH89c2UUMJrI5PCrXv_vK1NIBm3jM2IlbIu4
 * Cases Sheet: 1Ma1_6kERm9CpDnyb_F1N_IvaEYlitdt-p5q1Oop5pWg
 */

const { google } = require('googleapis');
const path = require('path');

// Sheet IDs — env-driven so we can swap the call log to the new
// O1dMatch-owned sheet without code changes. Master/cases default to the
// existing Sherrod sheets so client lookup still works.
const MASTER_LEAD_SHEET = process.env.MASTER_LEAD_SHEET_ID || '10yzVfq3aH89c2UUMJrI5PCrXv_vK1NIBm3jM2IlbIu4';
const CASES_SHEET = process.env.CASES_SHEET_ID || '1Ma1_6kERm9CpDnyb_F1N_IvaEYlitdt-p5q1Oop5pWg';
const CALL_LOG_SHEET = process.env.CALL_LOG_SHEET_ID || '1vLZhu75iyDFFVjQsUNHpiwDzIraEiXO5nVhdxPOUMfI';

// Call Log brand tabs (only the two brands this app handles)
const CALL_LOG_TABS = {
  'O1dMatch': 'O1dMatch',
  'Sevyn': 'Sevyn Sales Training'
};

// Brand → lead sheet tab (Sevyn leads aren't typical leads, so route to O1dMatch)
const BRAND_TABS = {
  'O1dMatch': 'O1dMatch',
  'Sevyn': 'O1dMatch'
};

// Initialize Google Sheets client
let sheetsClient = null;

async function initSheets() {
  if (sheetsClient) return sheetsClient;
  
  try {
    // Try environment variable first, then file
    let credentials;
    
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      console.log('📋 Using GOOGLE_SERVICE_ACCOUNT_JSON env var');
      console.log('   JSON length:', process.env.GOOGLE_SERVICE_ACCOUNT_JSON.length);
      try {
        credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        console.log('   Parsed successfully, email:', credentials.client_email);
      } catch (parseError) {
        console.error('   JSON parse error:', parseError.message);
        console.log('   First 100 chars:', process.env.GOOGLE_SERVICE_ACCOUNT_JSON.substring(0, 100));
        throw parseError;
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log('📋 Using GOOGLE_APPLICATION_CREDENTIALS file');
      const fs = require('fs');
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const fileContent = fs.readFileSync(credPath, 'utf8');
      credentials = JSON.parse(fileContent);
      console.log('   Loaded from:', credPath);
    } else {
      // Fallback to default path
      const fs = require('fs');
      const defaultPath = '/home/innovativeautomations/.openclaw/credentials/google-service-account.json';
      if (fs.existsSync(defaultPath)) {
        console.log('📋 Using default credentials path');
        const fileContent = fs.readFileSync(defaultPath, 'utf8');
        credentials = JSON.parse(fileContent);
      } else {
        throw new Error('No Google credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS');
      }
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets client initialized');
    return sheetsClient;
  } catch (error) {
    console.error('❌ Failed to init Google Sheets:', error.message);
    console.error('   Stack:', error.stack);
    return null;
  }
}

/**
 * Get the sheet ID (gid) for a specific tab
 */
async function getSheetGid(spreadsheetId, tabName) {
  const sheets = await initSheets();
  if (!sheets) return null;
  
  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties'
    });
    
    const sheet = response.data.sheets.find(s => 
      s.properties.title.toLowerCase() === tabName.toLowerCase()
    );
    
    return sheet ? sheet.properties.sheetId : null;
  } catch (error) {
    console.error(`Failed to get sheet GID for ${tabName}:`, error.message);
    return null;
  }
}

/**
 * Insert a row at the top of a sheet (row 2, after header) and write data
 */
async function insertRowAtTop(spreadsheetId, tabName, rowData) {
  const sheets = await initSheets();
  if (!sheets) return null;
  
  const sheetGid = await getSheetGid(spreadsheetId, tabName);
  if (sheetGid === null) {
    console.error(`Sheet tab "${tabName}" not found`);
    return null;
  }
  
  try {
    // 1. Insert a blank row at index 1 (row 2 in 1-indexed)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          insertDimension: {
            range: {
              sheetId: sheetGid,
              dimension: 'ROWS',
              startIndex: 1,  // 0-indexed, so row 2
              endIndex: 2
            },
            inheritFromBefore: false
          }
        }]
      }
    });
    
    // 2. Write data to the new row 2
    const range = `'${tabName}'!A2:${String.fromCharCode(64 + rowData.length)}2`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [rowData] }
    });
    
    console.log(`✅ Inserted row at top of ${tabName}`);
    return true;
  } catch (error) {
    console.error(`Failed to insert row at top of ${tabName}:`, error.message);
    return null;
  }
}

/**
 * Write a new lead to the Master Lead Sheet
 * @param {Object} lead - Lead data from call
 * @param {string} lead.brand - Brand name (SSV, Aventus, etc.)
 * @param {string} lead.caller_name - Full name
 * @param {string} lead.caller_phone - Phone number
 * @param {string} lead.caller_email - Email address
 * @param {string} lead.inquiry_topic - What they're calling about
 * @param {string} lead.summary - Call summary
 * @param {boolean} lead.follow_up_needed - Needs follow-up?
 */
async function writeLeadToSheet(lead) {
  const sheets = await initSheets();
  if (!sheets) {
    console.error('Sheets not initialized, skipping lead write');
    return null;
  }
  
  const brandTab = BRAND_TABS[lead.brand] || 'IGTA Lead Sheet';
  const centralTab = 'Knowledge Hub Registration Tracking Sheet'; // Central BD sheet
  const today = new Date().toLocaleDateString('en-US');
  
  // Build row based on typical lead sheet structure
  // Columns: Date | Full Name | Email | Phone | Lead Status | Notes | Source
  const row = [
    today,                              // Date of Initial Contact
    lead.caller_name || 'Unknown',      // Full Name
    lead.caller_email || '',            // Email
    lead.caller_phone || '',            // Phone Number
    'New - Voice Lead',                 // Lead Status
    lead.inquiry_topic || '',           // Notes/Topic
    lead.summary || '',                 // Additional Notes
    'Voice Call - Adriana',             // Source
    lead.follow_up_needed ? 'Yes' : 'No' // Follow-up Needed
  ];
  
  try {
    const results = { central: null, brand: null };
    
    // 1. Write to Central BD Sheet (Knowledge Hub Registration Tracking Sheet)
    // Columns: A=Origin Sheet | B=Name | C=Pseudonym | D=Email | E=Username Created | F=Registration Date | G=Password | H=Welcome Sent | I=(reminder) | J=Follow-up #1 Due
    // INSERT AT TOP (row 2) so new leads are visible first
    try {
      const centralRow = [
        lead.brand || 'Aventus',            // A: Origin Sheet (Brand)
        lead.caller_name || 'Unknown',      // B: Name
        '',                                 // C: Pseudonym (leave blank)
        lead.caller_email || '',            // D: Email
        lead.caller_phone || '',            // E: Username Created (Phone for now)
        lead.inquiry_topic || '',           // F: Registration Date/Topic
        '',                                 // G: Password (leave blank - not a KHub user yet)
        'Voice Call - Adriana',             // H: Welcome Sent
        lead.follow_up_needed ? 'Yes' : 'No', // I: (Follow-up flag)
        ''                                  // J: Follow-up #1 Due (to be set by automation)
      ];
      
      results.central = await insertRowAtTop(MASTER_LEAD_SHEET, centralTab, centralRow);
      if (results.central) {
        console.log(`✅ Lead inserted at TOP of ${centralTab}`);
      }
    } catch (err) {
      console.error(`❌ Failed to write to ${centralTab}:`, err.message);
    }
    
    // 2. Write to Brand-Specific Tab - INSERT AT TOP
    try {
      results.brand = await insertRowAtTop(MASTER_LEAD_SHEET, brandTab, row);
      if (results.brand) {
        console.log(`✅ Lead inserted at TOP of ${brandTab}`);
      }
    } catch (err) {
      console.error(`❌ Failed to write to ${brandTab}:`, err.message);
    }
    
    console.log(`✅ Lead recorded: ${lead.caller_name || lead.caller_phone} (${lead.brand})`);
    return results;
  } catch (error) {
    console.error(`❌ Failed to write lead:`, error.message);
    return null;
  }
}

/**
 * Search for existing client in Cases Sheet
 * @param {string} phone - Phone number to search
 * @returns {Object|null} - Client data if found
 */
async function findExistingClient(phone) {
  const sheets = await initSheets();
  if (!sheets) return null;
  
  // Normalize phone for comparison
  const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
  
  try {
    // Search in Processing Log tab
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: CASES_SHEET,
      range: "'Processing Log'!A:Z"
    });
    
    const rows = response.data.values || [];
    if (rows.length < 2) return null; // No data
    
    const headers = rows[0];
    const phoneColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('phone') || h?.toLowerCase().includes('contact')
    );
    const nameColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('beneficiary') || h?.toLowerCase().includes('name')
    );
    const statusColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('status') || h?.toLowerCase().includes('stage')
    );
    const visaColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('visa') || h?.toLowerCase().includes('type')
    );
    
    // Search for matching phone
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowPhone = (row[phoneColIndex] || '').replace(/\D/g, '').slice(-10);
      
      if (rowPhone === normalizedPhone) {
        return {
          found: true,
          name: row[nameColIndex] || 'Unknown',
          status: row[statusColIndex] || 'In Progress',
          visaType: row[visaColIndex] || 'Unknown',
          rowIndex: i + 1,
          source: 'Processing Log'
        };
      }
    }
    
    // Also check CURRENT CLIENTS tab in Master Lead Sheet
    const clientsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: MASTER_LEAD_SHEET,
      range: "'CURRENT CLIENTS'!A:Z"
    });
    
    const clientRows = clientsResponse.data.values || [];
    if (clientRows.length < 2) return null;
    
    const clientHeaders = clientRows[0];
    const clientPhoneIdx = clientHeaders.findIndex(h => 
      h?.toLowerCase().includes('phone')
    );
    const clientNameIdx = clientHeaders.findIndex(h => 
      h?.toLowerCase().includes('name')
    );
    const clientStatusIdx = clientHeaders.findIndex(h => 
      h?.toLowerCase().includes('status')
    );
    
    for (let i = 1; i < clientRows.length; i++) {
      const row = clientRows[i];
      const rowPhone = (row[clientPhoneIdx] || '').replace(/\D/g, '').slice(-10);
      
      if (rowPhone === normalizedPhone) {
        return {
          found: true,
          name: row[clientNameIdx] || 'Unknown',
          status: row[clientStatusIdx] || 'Active Client',
          source: 'CURRENT CLIENTS'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Failed to search for client:', error.message);
    return null;
  }
}

/**
 * Search for client by name
 * @param {string} name - Name to search
 * @returns {Object|null} - Client data if found
 */
async function findClientByName(name) {
  const sheets = await initSheets();
  if (!sheets) return null;
  
  const searchName = name.toLowerCase().trim();
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: CASES_SHEET,
      range: "'Processing Log'!A:Z"
    });
    
    const rows = response.data.values || [];
    if (rows.length < 2) return null;
    
    const headers = rows[0];
    const nameColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('beneficiary') || h?.toLowerCase().includes('name')
    );
    const statusColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('status') || h?.toLowerCase().includes('stage')
    );
    const visaColIndex = headers.findIndex(h => 
      h?.toLowerCase().includes('visa') || h?.toLowerCase().includes('type')
    );
    
    // Search for matching name (partial match)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowName = (row[nameColIndex] || '').toLowerCase();
      
      if (rowName.includes(searchName) || searchName.includes(rowName)) {
        return {
          found: true,
          name: row[nameColIndex] || 'Unknown',
          status: row[statusColIndex] || 'In Progress',
          visaType: row[visaColIndex] || 'Unknown',
          rowIndex: i + 1
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Failed to search by name:', error.message);
    return null;
  }
}

/**
 * Get sheet tabs (for debugging)
 */
async function getSheetTabs(sheetId) {
  const sheets = await initSheets();
  if (!sheets) return [];
  
  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties.title'
    });
    
    return response.data.sheets.map(s => s.properties.title);
  } catch (error) {
    console.error('Failed to get sheet tabs:', error.message);
    return [];
  }
}

/**
 * Test connection to sheets
 */
async function testConnection() {
  const sheets = await initSheets();
  if (!sheets) return { success: false, error: 'Failed to initialize' };
  
  try {
    const masterTabs = await getSheetTabs(MASTER_LEAD_SHEET);
    const casesTabs = await getSheetTabs(CASES_SHEET);
    
    return {
      success: true,
      masterLeadSheet: {
        id: MASTER_LEAD_SHEET,
        tabs: masterTabs.slice(0, 10), // First 10 tabs
        totalTabs: masterTabs.length
      },
      casesSheet: {
        id: CASES_SHEET,
        tabs: casesTabs,
        totalTabs: casesTabs.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Write call to Call Log Sheet
 * @param {Object} call - Call data
 */
async function writeCallLog(call) {
  const sheets = await initSheets();
  if (!sheets) {
    console.error('Sheets not initialized, skipping call log');
    return null;
  }
  
  const brandTab = CALL_LOG_TABS[call.brand] || 'All Calls';
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  
  // Row format: Timestamp | Brand | Caller Phone | Caller Name | Caller Email | Type | Inquiry Topic | Outcome | Follow Up | Duration (min) | Summary | Call ID
  const row = [
    timestamp,
    call.brand || '',
    call.caller_phone || '',
    call.caller_name || '',
    call.caller_email || '',
    call.caller_type || 'unknown',
    call.inquiry_topic || '',
    call.outcome || 'completed',
    call.follow_up_needed ? 'Yes' : 'No',
    call.duration_min || '',
    call.summary || '',
    call.call_id || ''
  ];
  
  const results = { allCalls: null, brand: null };
  
  try {
    // 1. Write to "All Calls" tab
    const allCallsResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: CALL_LOG_SHEET,
      range: "'All Calls'!A:L",
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] }
    });
    results.allCalls = allCallsResponse.data;
    console.log(`✅ Call logged to All Calls tab`);
    
    // 2. Write to brand-specific tab (if not Sevyn)
    if (brandTab !== 'All Calls') {
      const brandResponse = await sheets.spreadsheets.values.append({
        spreadsheetId: CALL_LOG_SHEET,
        range: `'${brandTab}'!A:L`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });
      results.brand = brandResponse.data;
      console.log(`✅ Call logged to ${brandTab} tab`);
    }
    
    return results;
  } catch (error) {
    console.error(`❌ Failed to write call log:`, error.message);
    return null;
  }
}

/**
 * Write transcript to Call Log Sheet (separate column or tab)
 * @param {string} callId - Call ID to update
 * @param {string} transcript - Full transcript
 */
async function writeTranscript(callId, transcript) {
  // For now, transcripts are included in the summary
  // Full transcripts can be stored in Supabase or a dedicated Transcripts tab
  console.log(`📝 Transcript for ${callId}: ${transcript?.length || 0} chars`);
  return { success: true, callId };
}

module.exports = {
  initSheets,
  writeLeadToSheet,
  writeCallLog,
  writeTranscript,
  findExistingClient,
  findClientByName,
  getSheetTabs,
  testConnection,
  MASTER_LEAD_SHEET,
  CASES_SHEET,
  CALL_LOG_SHEET,
  BRAND_TABS,
  CALL_LOG_TABS
};
