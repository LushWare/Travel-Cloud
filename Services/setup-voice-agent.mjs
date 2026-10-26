import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(ROOT, 'voice-service', '.env');
const DOC_PATH = path.join(ROOT, '..', 'docs', 'voice-agent-prompt.md');
const API = 'https://api.elevenlabs.io/v1';
const OWNED_TOOL_NAMES = new Set([
  'search_packages', 'get_trip_status', 'get_payment_status', 'attach_package',
  'adjust_itinerary', 'preview_price', 'resend_document',
]);

const ANALYSIS_FIELDS = {
  destination: { type: 'string', description: 'Where the caller wants to travel. Leave empty if not stated.' },
  travelers: { type: 'integer', description: 'Total number of people travelling, adults and children. Leave empty if not stated.' },
  duration: { type: 'integer', description: 'Number of nights. Leave empty if not stated.' },
  budget: { type: 'string', description: 'Budget exactly as the caller expressed it. Leave empty if not stated.' },
  preferences: { type: 'string', description: 'Occasion, dates, departure country, or other trip preferences.' },
  email: { type: 'string', description: 'The caller\'s email address, only if they gave one.' },
  selected_package_id: {
    type: 'string',
    description: 'Exact package_id from a search_packages result, only when the caller confirmed that package. Never invent or guess one.',
  },
  needs_rep_followup: {
    type: 'boolean',
    description: 'True if a specialist must call back, including when the agent promised follow-up or could not resolve the request. False only when fully resolved.',
  },
  user_sentiment: {
    type: 'string',
    description: 'Caller sentiment: Positive, Neutral, or Negative.',
    enum: ['Positive', 'Neutral', 'Negative'],
  },
};

function readEnv(key) {
  if (!fs.existsSync(ENV_PATH)) return null;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? (match[1].trim().replace(/^['"](.*)['"]$/, '$1') || null) : null;
}

function fail(message, hint) {
  console.error(`\nERROR: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

function blockAfter(doc, heading) {
  const at = doc.indexOf(heading);
  if (at === -1) return null;
  const fence = doc.indexOf('```', at);
  if (fence === -1) return null;
  const start = doc.indexOf('\n', fence) + 1;
  const end = doc.indexOf('```', start);
  return end === -1 ? null : doc.slice(start, end).trimEnd();
}

async function api(method, route, key, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = null; }
  if (!response.ok) fail(`ElevenLabs ${method} ${route} returned ${response.status}: ${text.slice(0, 400)}`);
  return result;
}

function jsonSchema(properties, required = []) {
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function buildTools(baseUrl, toolSecret) {
  const tool = (name, description, properties = {}, required = [], timeout = 20, speak = false) => ({
    type: 'webhook',
    name,
    description,
    execution_mode: 'immediate',
    pre_tool_speech: speak ? 'force' : 'auto',
    response_timeout_secs: timeout,
    tool_error_handling_mode: 'summarized',
    api_schema: {
      url: `${baseUrl}/api/v1/webhooks/voice/fn/${name}`,
      method: 'POST',
      request_headers: {
        'x-elevenlabs-tool-secret': toolSecret,
        'x-elevenlabs-conversation-id': {
          type: 'dynamic_variable',
          variable_name: 'system__conversation_id',
        },
      },
      request_body_schema: jsonSchema(properties, required),
      response_filter: { mode: 'all' },
    },
  });

  return [
    tool(
      'search_packages',
      'Search company travel packages by destination or keyword. No prices are returned.',
      { query: { type: 'string', description: 'Destination or keyword the caller is asking about.' } },
      ['query'], 20, true,
    ),
    tool('get_trip_status', 'Get this caller\'s current trip status, destination, dates, travellers, and enquiry progress. Never returns a price.'),
    tool('get_payment_status', 'Get payment figures only when the caller explicitly asks about price, payment, invoice, deposit, or balance. Figures are returned only for a quotation already sent.'),
    tool(
      'attach_package',
      'Attach a package from search results to this caller\'s enquiry. Requires the caller to have confirmed the trip is theirs.',
      {
        package_id: { type: 'string', description: 'package_id from a prior search_packages result.' },
        trip_confirmed: { type: 'boolean', description: 'True only after explicit caller confirmation of the trip.' },
      },
      ['package_id', 'trip_confirmed'], 20, true,
    ),
    tool(
      'adjust_itinerary',
      'Prepare an itinerary change for a specialist to review. Never commits pricing and requires explicit trip confirmation.',
      {
        add_nights: { type: 'integer', description: 'Number of nights to add, if any.' },
        remove_nights: { type: 'integer', description: 'Number of nights to remove, if any.' },
        hotel_name: { type: 'string', description: 'Replacement hotel, if named.' },
        destination: { type: 'string', description: 'New destination, if requested.' },
        trip_confirmed: { type: 'boolean', description: 'True only after explicit caller confirmation of the trip.' },
      },
      ['trip_confirmed'], 30, true,
    ),
    tool('preview_price', 'Refresh the draft price for a specialist. The response never contains a number; only call after adjust_itinerary.'),
    tool('resend_document', 'Resend the most recently sent quotation, invoice, receipt, or voucher to the customer on file. Does nothing if no document was previously sent.', {}, [], 30, true),
  ];
}

async function listTools(key, agentId) {
  const tools = [];
  let cursor;
  do {
    const query = new URLSearchParams({ used_by_agent_id: agentId, page_size: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await api('GET', `/convai/tools?${query}`, key);
    tools.push(...(page.tools ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return tools;
}

const key = readEnv('ELEVENLABS_API_KEY');
const agentId = readEnv('ELEVENLABS_AGENT_ID');
const toolSecret = readEnv('ELEVENLABS_TOOL_SECRET');
const initiationSecret = readEnv('ELEVENLABS_INITIATION_SECRET');
const publicBaseUrl = readEnv('ELEVENLABS_PUBLIC_BASE_URL');
if (!key) fail('ELEVENLABS_API_KEY is missing from voice-service/.env');
if (!agentId) fail('ELEVENLABS_AGENT_ID is missing from voice-service/.env');
if (!toolSecret) fail('ELEVENLABS_TOOL_SECRET is missing from voice-service/.env');
if (!initiationSecret) fail('ELEVENLABS_INITIATION_SECRET is missing from voice-service/.env');
if (!publicBaseUrl) fail('ELEVENLABS_PUBLIC_BASE_URL is missing from voice-service/.env');
if (!fs.existsSync(DOC_PATH)) fail(`Prompt file not found: ${DOC_PATH}`);

const doc = fs.readFileSync(DOC_PATH, 'utf8');
const firstMessage = blockAfter(doc, '## 1. First message');
const prompt = blockAfter(doc, '## 2. General prompt');
if (!firstMessage || !prompt || prompt.length < 500) fail('The first message or general prompt is missing or truncated.');

const REQUIRED_PHRASES = ['Never say a price', 'flight costs or fares', 'Never look someone up'];
const missingRules = REQUIRED_PHRASES.filter((phrase) => !prompt.includes(phrase));
if (missingRules.length) fail(`The prompt is missing safety rules: ${missingRules.join(', ')}`);

const baseUrl = publicBaseUrl.replace(/\/$/, '');
const tools = buildTools(baseUrl, toolSecret);
console.log(`\nElevenLabs agent ${agentId}`);
console.log(`Prompt ${prompt.length} chars; tools ${tools.map(({ name }) => name).join(', ')}`);
console.log(`Initiation ${baseUrl}/api/v1/webhooks/voice/inbound`);
console.log(`Post-call ${baseUrl}/api/v1/webhooks/voice/post-call`);

if (!process.argv.includes('--apply')) {
  console.log('\nDry run. No ElevenLabs resources were changed. Add --apply to sync the agent.\n');
  process.exit(0);
}

const [agent, existingTools] = await Promise.all([
  api('GET', `/convai/agents/${encodeURIComponent(agentId)}`, key),
  listTools(key, agentId),
]);
const existingByName = new Map(
  existingTools
    .filter(({ tool_config }) => OWNED_TOOL_NAMES.has(tool_config?.name))
    .map(({ id, tool_config }) => [tool_config.name, id])
);

const toolIds = [];
for (const toolConfig of tools) {
  const existingId = existingByName.get(toolConfig.name);
  const saved = existingId
    ? await api('PATCH', `/convai/tools/${encodeURIComponent(existingId)}`, key, { tool_config: toolConfig })
    : await api('POST', '/convai/tools', key, { tool_config: toolConfig });
  toolIds.push(saved.id);
}

const attachedTools = new Map(existingTools.map(({ id, tool_config }) => [id, tool_config?.name]));
const preservedToolIds = (agent.conversation_config?.agent?.prompt?.tool_ids ?? [])
  .filter((id) => !OWNED_TOOL_NAMES.has(attachedTools.get(id)));

let webhookId = readEnv('ELEVENLABS_POST_CALL_WEBHOOK_ID');
let webhookSecret = null;
if (!webhookId) {
  const webhook = await api('POST', '/workspace/webhooks', key, {
    settings: {
      auth_type: 'hmac',
      name: 'Travel CRM voice calls',
      webhook_url: `${baseUrl}/api/v1/webhooks/voice/post-call`,
    },
  });
  webhookId = webhook.webhook_id;
  webhookSecret = webhook.webhook_secret;
  console.log(`\nNew post-call webhook id: ${webhookId}`);
  console.log('Store this new signing secret in voice-service/.env as ELEVENLABS_WEBHOOK_SECRET:');
  console.log(webhookSecret);
  await api('PATCH', `/workspace/webhooks/${encodeURIComponent(webhookId)}`, key, {
    is_disabled: false,
    name: 'Travel CRM voice calls',
    retry_enabled: true,
  });
} else if (!readEnv('ELEVENLABS_WEBHOOK_SECRET')) {
  fail('ELEVENLABS_WEBHOOK_SECRET is missing from voice-service/.env for the configured post-call webhook.');
}

await api('PATCH', `/convai/agents/${encodeURIComponent(agentId)}`, key, {
  conversation_config: {
    agent: {
      first_message: firstMessage,
      prompt: { prompt, tool_ids: [...preservedToolIds, ...toolIds] },
    },
  },
  platform_settings: {
    data_collection: ANALYSIS_FIELDS,
    privacy: { record_voice: true, delete_audio: false, delete_transcript_and_pii: false },
    overrides: { enable_conversation_initiation_client_data_from_webhook: true },
  },
  workspace_overrides: {
    conversation_initiation_client_data_webhook: {
      url: `${baseUrl}/api/v1/webhooks/voice/inbound`,
      request_headers: { 'x-elevenlabs-init-secret': initiationSecret },
    },
    webhooks: { post_call_webhook_id: webhookId, events: ['transcript'] },
  },
});

console.log('\nElevenLabs agent, tools, initiation webhook, and post-call webhook are configured.');
console.log('Run a real inbound test call before pointing the published number at this agent.\n');