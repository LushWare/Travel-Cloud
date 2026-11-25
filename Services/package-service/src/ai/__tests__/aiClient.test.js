import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockOpenAI, mockGemini } = vi.hoisted(() => ({ mockOpenAI: vi.fn(), mockGemini: vi.fn() }));

vi.mock('../openaiClient.js', () => ({
  generateStructured: mockOpenAI,
  isOpenAIConfigured: () => Boolean(process.env.OPENAI_API_KEY),
}));
vi.mock('../geminiClient.js', () => ({
  generateStructured: mockGemini,
  isAIConfigured: () => Boolean(process.env.GEMINI_API_KEY),
}));
vi.mock('../../config/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { generateStructured, isAIConfigured } = await import('../aiClient.js');

describe('aiClient', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('answers from OpenAI when it succeeds', async () => {
    mockOpenAI.mockResolvedValueOnce({ from: 'openai' });

    await expect(generateStructured({ prompt: 'p', schema: {} })).resolves.toEqual({ from: 'openai' });
    expect(mockGemini).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when OpenAI fails', async () => {
    mockOpenAI.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 502 }));
    mockGemini.mockResolvedValueOnce({ from: 'gemini' });

    await expect(generateStructured({ prompt: 'p', schema: {} })).resolves.toEqual({ from: 'gemini' });
  });

  it('passes the Gemini model only to Gemini and the OpenAI model only to OpenAI', async () => {
    mockOpenAI.mockRejectedValueOnce(new Error('down'));
    mockGemini.mockResolvedValueOnce({});

    await generateStructured({ prompt: 'p', schema: {}, model: 'gemini-x', openaiModel: 'gpt-y' });

    expect(mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-y' }));
    expect(mockGemini).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-x' }));
  });

  it('caps OpenAI at two attempts when Gemini is there as backup', async () => {
    mockOpenAI.mockResolvedValueOnce({});

    await generateStructured({ prompt: 'p', schema: {} });

    expect(mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 2 }));
  });

  it('keeps the caller\'s attempt count for OpenAI when there is no backup', async () => {
    delete process.env.GEMINI_API_KEY;
    mockOpenAI.mockResolvedValueOnce({});

    await generateStructured({ prompt: 'p', schema: {}, maxAttempts: 3 });

    expect(mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 3 }));
  });

  it('rethrows the OpenAI error when no Gemini key is set', async () => {
    delete process.env.GEMINI_API_KEY;
    mockOpenAI.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 502 }));

    await expect(generateStructured({ prompt: 'p', schema: {} })).rejects.toMatchObject({ statusCode: 502 });
    expect(mockGemini).not.toHaveBeenCalled();
  });

  it('uses Gemini directly when no OpenAI key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    mockGemini.mockResolvedValueOnce({ from: 'gemini' });

    await expect(generateStructured({ prompt: 'p', schema: {} })).resolves.toEqual({ from: 'gemini' });
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it('skips the fallback when the caller\'s deadline is nearly spent', async () => {
    mockOpenAI.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new Error('down');
    });

    await expect(generateStructured({ prompt: 'p', schema: {}, deadlineMs: 1_020 })).rejects.toThrow('down');
    expect(mockGemini).not.toHaveBeenCalled();
  });

  it('hands Gemini only what is left of the deadline', async () => {
    mockOpenAI.mockRejectedValueOnce(new Error('down'));
    mockGemini.mockResolvedValueOnce({});

    await generateStructured({ prompt: 'p', schema: {}, deadlineMs: 10_000 });

    const { deadlineMs } = mockGemini.mock.calls[0][0];
    expect(deadlineMs).toBeGreaterThan(9_000);
    expect(deadlineMs).toBeLessThanOrEqual(10_000);
  });

  it('reports configured when either key is set', () => {
    delete process.env.GEMINI_API_KEY;
    expect(isAIConfigured()).toBe(true);
    process.env.OPENAI_API_KEY = '';
    expect(isAIConfigured()).toBe(false);
  });
});
