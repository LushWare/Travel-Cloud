import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, note: { type: 'string' } }, required: ['title'] };

const reply = (text, extra = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], ...extra }),
});

const failure = (status, headers = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({ error: { message: `status ${status}` } }),
});

describe('openaiClient', () => {
  const ORIGINAL_ENV = process.env;
  let mockFetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, OPENAI_API_KEY: 'sk-test' };
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it('returns the parsed JSON with optional nulls removed', async () => {
    mockFetch.mockResolvedValueOnce(reply('{"title":"Bali Escape","note":null}'));
    const { generateStructured } = await import('../openaiClient.js');

    const result = await generateStructured({ prompt: 'p', schema: SCHEMA });

    expect(result).toEqual({ title: 'Bali Escape' });
  });

  it('sends a strict json_schema format, the reasoning effort and no temperature', async () => {
    mockFetch.mockResolvedValueOnce(reply('{"title":"x"}'));
    const { generateStructured } = await import('../openaiClient.js');

    await generateStructured({ prompt: 'p', schema: SCHEMA, model: 'gpt-6-luna', reasoningEffort: 'none', temperature: 0.7 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.required).toEqual(['title', 'note']);
    expect(body).not.toHaveProperty('temperature');
  });

  it('throws a 503 without calling the API when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 503 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a typed 502 when the reply is not valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(reply('not json'));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 502, aiFailureCategory: 'schema' });
  });

  it('throws a 502 when the model refuses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }),
    });
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 502 });
  });

  it('retries a 503 and succeeds once the API recovers', async () => {
    mockFetch.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(reply('{"title":"ok"}'));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).resolves.toEqual({ title: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('honours retry-after-ms on a 429', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(failure(429, { 'retry-after-ms': '4000' })).mockResolvedValueOnce(reply('{"title":"ok"}'));
    const { generateStructured } = await import('../openaiClient.js');

    const pending = generateStructured({ prompt: 'p', schema: SCHEMA });
    await vi.advanceTimersByTimeAsync(3_900);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual({ title: 'ok' });
    vi.useRealTimers();
  });

  it('does not retry a 429 that reports an exhausted balance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({ error: { message: 'You have no credits remaining.', code: 'insufficient_quota' } }),
    });
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 502 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast with a 503 on a rejected key', async () => {
    mockFetch.mockResolvedValueOnce(failure(401));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 503 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400', async () => {
    mockFetch.mockResolvedValueOnce(failure(400));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA })).rejects.toMatchObject({ statusCode: 502, aiFailureCategory: 'provider' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a truncated reply with a 1.5x larger token budget', async () => {
    mockFetch
      .mockResolvedValueOnce(reply('{"title":"cut', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
      .mockResolvedValueOnce(reply('{"title":"whole"}'));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA, maxOutputTokens: 1000 })).resolves.toEqual({ title: 'whole' });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).max_output_tokens).toBe(1500);
  });

  it('accepts a truncated reply that still parses when the caller allows it', async () => {
    mockFetch.mockResolvedValueOnce(reply('{"title":"enough"}', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA, allowTruncated: true })).resolves.toEqual({ title: 'enough' });
  });

  it('reports a timeout category when the request is aborted', async () => {
    mockFetch.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA, timeoutMs: 10, maxAttempts: 1 })).rejects.toMatchObject({
      statusCode: 502,
      aiFailureCategory: 'timeout',
    });
  });

  it('stops retrying when the deadline leaves too little time for another attempt', async () => {
    mockFetch.mockResolvedValue(failure(503));
    const { generateStructured } = await import('../openaiClient.js');

    await expect(generateStructured({ prompt: 'p', schema: SCHEMA, deadlineMs: 3_000 })).rejects.toMatchObject({ statusCode: 502 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
