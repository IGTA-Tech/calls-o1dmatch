/**
 * Voice Provider — Vapi only. The original multi-brand app supported both
 * Retell and Vapi via VOICE_PROVIDER, but this O1dMatch-only app runs on
 * Vapi exclusively, so the router is just a thin re-export.
 */

const vapiClient = require('./vapi-client');
const vapiWebhook = require('./vapi-webhook');

console.log('🎙️  Voice provider: VAPI');

module.exports = {
  PROVIDER: 'vapi',
  BRAND_CONFIGS: vapiClient.BRAND_CONFIGS,
  BRAND_PHONES: vapiClient.BRAND_PHONES,
  getBrandConfig: vapiClient.getBrandConfig,
  createPhoneCall: vapiClient.createPhoneCall,
  getCall: vapiClient.getCall,
  handleVapiWebhook: vapiWebhook.handleVapiWebhook,
  handleRetellWebhook: null,
  retell: null,
  vapi: vapiClient
};
