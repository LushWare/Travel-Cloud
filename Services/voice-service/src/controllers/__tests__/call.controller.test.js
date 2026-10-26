import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const mockVoiceCallFindMany = vi.fn();
const mockVoiceCallFindUnique = vi.fn();
vi.mock('../../db/client.js', () => ({
  default: {
    voiceCall: {
      findMany: (...args) => mockVoiceCallFindMany(...args),
      findUnique: (...args) => mockVoiceCallFindUnique(...args),
    },
  },
}));

const { default: app } = await import('../../app.js');
const CALL_ID = '11111111-1111-4111-8111-111111111111';
const originalApiKey = process.env.ELEVENLABS_API_KEY;
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ELEVENLABS_API_KEY = 'test-api-key';
  mockVoiceCallFindMany.mockResolvedValue([]);
  mockVoiceCallFindUnique.mockResolvedValue({ conversationId: 'conv_abc123', recordingUrl: 'elevenlabs' });
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalApiKey;
});

function asSalesRep(req) {
  return req.set('x-user-id', 'user-1').set('x-user-role', 'salesRep');
}

describe('voice call routes', () => {
  it('requires authentication to stream a recording', async () => {
    const response = await request(app).get(`/api/v1/voice/calls/${CALL_ID}/recording`);
    expect(response.status).toBe(401);
    expect(global.fetch).toBe(originalFetch);
  });

  it('streams a recording through the ElevenLabs API without exposing its API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('audio-data'), {
      headers: { 'content-type': 'audio/mpeg' },
    }));
    global.fetch = fetchMock;

    const response = await asSalesRep(request(app).get(`/api/v1/voice/calls/${CALL_ID}/recording`));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('audio/mpeg');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(Buffer.from('audio-data'));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/convai/conversations/conv_abc123/audio',
      { headers: { 'xi-api-key': 'test-api-key' } },
    );
  });

  it('marks calls with audio available for the Management player', async () => {
    mockVoiceCallFindMany.mockResolvedValue([{
      id: 'call-1',
      recordingUrl: 'elevenlabs',
      events: [],
    }]);

    const response = await asSalesRep(request(app).get('/api/v1/voice/leads/11111111-1111-4111-8111-111111111111/calls'));

    expect(response.status).toBe(200);
    expect(response.body.data[0].hasRecording).toBe(true);
  });
});