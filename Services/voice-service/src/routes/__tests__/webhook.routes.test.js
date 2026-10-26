import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

const WEBHOOK_SECRET = 'elevenlabs-webhook-test-secret';
const INITIATION_SECRET = 'elevenlabs-init-test-secret';
process.env.ELEVENLABS_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.ELEVENLABS_INITIATION_SECRET = INITIATION_SECRET;

const mockVoiceNumberFindFirst = vi.fn();
const mockVoiceCallUpsert = vi.fn();
const mockVoiceCallFindUnique = vi.fn();
const mockVoiceCallCreate = vi.fn();
const mockVoiceCallUpdate = vi.fn();
vi.mock('../../db/client.js', () => ({
  default: {
    voiceNumber: { findFirst: (...args) => mockVoiceNumberFindFirst(...args) },
    voiceCall: {
      upsert: (...args) => mockVoiceCallUpsert(...args),
      findUnique: (...args) => mockVoiceCallFindUnique(...args),
      create: (...args) => mockVoiceCallCreate(...args),
      update: (...args) => mockVoiceCallUpdate(...args),
    },
  },
}));

const mockLookup = vi.fn();
const mockSubmitIntake = vi.fn();
vi.mock('../../services/lead.client.js', () => ({
  lookupLeadsByPhone: (...args) => mockLookup(...args),
  submitIntake: (...args) => mockSubmitIntake(...args),
  logCallCommunication: vi.fn(),
}));

const mockNotify = vi.fn();
vi.mock('../../services/notify.service.js', () => ({
  notifyRepsOfCallback: (...args) => mockNotify(...args),
}));

const mockIsOverDailyCap = vi.fn();
vi.mock('../../services/callVolume.service.js', () => ({
  isOverDailyCap: (...args) => mockIsOverDailyCap(...args),
}));

const { default: app } = await import('../../app.js');

const sign = (raw, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) => {
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return `t=${timestamp},v0=${digest}`;
};

const postCallBody = (overrides = {}) => ({
  type: 'post_call_transcription',
  event_timestamp: 1792933200,
  data: {
    conversation_id: 'conv_abc123',
    agent_id: 'agent_live',
    status: 'done',
    has_audio: true,
    transcript: [
      { role: 'agent', message: 'Thanks for calling.' },
      { role: 'user', message: 'I want to go to the Maldives in December.' },
    ],
    metadata: {
      start_time_unix_secs: 1792932960,
      call_duration_secs: 240,
      cost_fiat: 1.25,
      phone_call: { direction: 'inbound', external_number: '+94771234567', agent_number: '+94112223333' },
    },
    analysis: {
      transcript_summary: 'New Maldives enquiry',
      data_collection_results: {
        destination: { value: 'Maldives' },
        travelers: { value: 2 },
        duration: { value: 7 },
        needs_rep_followup: { value: true },
        user_sentiment: { value: 'Positive' },
      },
    },
    ...overrides,
  },
});

const postSigned = async (path, body, { secret = WEBHOOK_SECRET, signature } = {}) => {
  const raw = JSON.stringify(body);
  return request(app)
    .post(path)
    .set('content-type', 'application/json')
    .set('elevenlabs-signature', signature ?? sign(raw, secret))
    .send(raw);
};

const postInitiation = async (body, secret = INITIATION_SECRET) => request(app)
  .post('/api/v1/webhooks/voice/inbound')
  .set('content-type', 'application/json')
  .set('x-elevenlabs-init-secret', secret)
  .send(body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ELEVENLABS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.ELEVENLABS_INITIATION_SECRET = INITIATION_SECRET;
  mockVoiceNumberFindFirst.mockResolvedValue({
    id: 'num-1', e164: '94112223333', agentId: 'agent_live', label: 'Lushware Travel',
    disclosureText: 'This call is recorded.',
  });
  mockVoiceCallUpsert.mockResolvedValue({ id: 'vc-1', leadId: null });
  mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, needsRepFollowup: false });
  mockVoiceCallCreate.mockResolvedValue({ id: 'vc-1', leadId: null });
  mockVoiceCallUpdate.mockResolvedValue({ id: 'vc-1' });
  mockLookup.mockResolvedValue({ matches: [], samePerson: true });
  mockSubmitIntake.mockResolvedValue({ leadId: 'lead-9', created: true });
  mockNotify.mockResolvedValue({ notified: 2 });
  mockIsOverDailyCap.mockResolvedValue({ overCap: false, count: 0, cap: 20 });
});

afterAll(() => {
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
  delete process.env.ELEVENLABS_INITIATION_SECRET;
});

describe('POST /api/v1/webhooks/voice/inbound', () => {
  const body = {
    caller_id: '+94771234567',
    called_number: '+94112223333',
    agent_id: 'agent_live',
    conversation_id: 'conv_abc123',
    call_sid: 'CA123',
  };

  it('rejects a missing initiation secret', async () => {
    const res = await request(app).post('/api/v1/webhooks/voice/inbound').send(body);
    expect(res.status).toBe(401);
  });

  it('rejects the wrong initiation secret', async () => {
    const res = await postInitiation(body, 'wrong');
    expect(res.status).toBe(401);
  });

  it('returns ElevenLabs initiation data with whitelisted caller variables', async () => {
    mockLookup.mockResolvedValue({ matches: [{ leadId: 'lead-1', firstName: 'Nimal' }], samePerson: true });
    const res = await postInitiation(body);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('conversation_initiation_client_data');
    expect(res.body.dynamic_variables.caller_name).toBe('Nimal');
    expect(JSON.stringify(res.body.dynamic_variables)).not.toContain('lead-1');
  });

  it('creates the in-progress call keyed by ElevenLabs conversation id', async () => {
    await postInitiation(body);
    expect(mockVoiceCallUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv_abc123' },
      create: expect.objectContaining({
        conversationId: 'conv_abc123',
        fromNumber: '94771234567',
        toNumber: '94112223333',
        numberId: 'num-1',
      }),
    }));
  });

  it('returns 404 when the dialled number is not registered', async () => {
    mockVoiceNumberFindFirst.mockResolvedValue(null);
    const res = await postInitiation(body);
    expect(res.status).toBe(404);
  });

  it('rejects an agent that does not match the number registration', async () => {
    const res = await postInitiation({ ...body, agent_id: 'agent_other' });
    expect(res.status).toBe(409);
    expect(mockVoiceCallUpsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid initiation body', async () => {
    const res = await postInitiation({ ...body, called_number: undefined });
    expect(res.status).toBe(400);
  });

  it('skips identity lookup when the caller is over the daily cap', async () => {
    mockIsOverDailyCap.mockResolvedValue({ overCap: true, count: 20, cap: 20 });
    const res = await postInitiation(body);
    expect(res.status).toBe(200);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(res.body.dynamic_variables.caller_known).toBe('false');
  });
});

describe('POST /api/v1/webhooks/voice/post-call', () => {
  it('rejects an unsigned transcription webhook', async () => {
    const res = await request(app).post('/api/v1/webhooks/voice/post-call').send(postCallBody());
    expect(res.status).toBe(401);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const res = await postSigned('/api/v1/webhooks/voice/post-call', postCallBody(), { secret: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects a signature older than the ElevenLabs replay window', async () => {
    const raw = JSON.stringify(postCallBody());
    const stale = sign(raw, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 31 * 60);
    const res = await postSigned('/api/v1/webhooks/voice/post-call', postCallBody(), { signature: stale });
    expect(res.status).toBe(401);
  });

  it('stores the call and normalizes the transcript and billing metadata', async () => {
    await postSigned('/api/v1/webhooks/voice/post-call', postCallBody());
    expect(mockVoiceCallUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 'vc-1' },
      data: {
        durationSec: 240,
        costCents: 125,
        summary: 'New Maldives enquiry',
        sentiment: 'Positive',
        disposition: 'COMPLETED',
        recordingUrl: 'elevenlabs',
      },
    });
    expect(mockSubmitIntake.mock.calls[0][0]).toMatchObject({
      channel: 'voice', sessionId: 'conv_abc123', contact: { phone: '94771234567' },
      slots: { destination: 'Maldives', travelers: 2, duration: 7 },
    });
  });

  it('updates the call row created during initiation instead of creating another', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-existing', leadId: null, needsRepFollowup: false });
    await postSigned('/api/v1/webhooks/voice/post-call', postCallBody());
    expect(mockVoiceCallCreate).not.toHaveBeenCalled();
    expect(mockVoiceCallUpdate.mock.calls[0][0].where).toEqual({ id: 'vc-existing' });
  });

  it('does not submit intake when no transcript was captured', async () => {
    const body = postCallBody();
    body.data.transcript = [];
    await postSigned('/api/v1/webhooks/voice/post-call', body);
    expect(mockSubmitIntake).not.toHaveBeenCalled();
  });

  it('treats an omitted follow-up result as requiring a rep callback', async () => {
    const body = postCallBody();
    delete body.data.analysis.data_collection_results.needs_rep_followup;
    await postSigned('/api/v1/webhooks/voice/post-call', body);
    expect(mockVoiceCallUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ needsRepFollowup: true }),
    }));
    expect(mockNotify).toHaveBeenCalled();
  });

  it('acknowledges non-transcription events without creating calls', async () => {
    const body = { type: 'post_call_audio', data: { conversation_id: 'conv_abc123' } };
    const res = await postSigned('/api/v1/webhooks/voice/post-call', body);
    expect(res.status).toBe(200);
    expect(mockVoiceCallUpdate).not.toHaveBeenCalled();
    expect(mockVoiceCallCreate).not.toHaveBeenCalled();
  });
});