import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

const { extractCitations, extractText, generateGrounded } = await import('../groundedSearch.js');

const CHUNK_RESPONSE = {
  text: 'Sri Lanka is best visited between December and March.',
  candidates: [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: 'https://www.example.com/sri-lanka', title: 'example.com' } },
          { web: { uri: 'https://www.example.com/sri-lanka', title: 'example.com' } },
          { web: { uri: 'https://travel.state.gov/sri-lanka', title: 'travel.state.gov' } },
          { web: { uri: 'javascript:alert(1)', title: 'bad' } },
        ],
      },
    },
  ],
};

const STEP_RESPONSE = {
  output_text: 'Kandy is mild all year, with a wetter October.',
  steps: [
    {
      type: 'model_output',
      content: [
        {
          text: 'Kandy is mild all year, with a wetter October.',
          annotations: [
            { type: 'url_citation', url: 'https://www.example.org/kandy-weather', title: 'example.org' },
            { type: 'other_marker', url: 'https://ignored.example' },
          ],
        },
      ],
    },
  ],
};

describe('extractCitations', () => {
  it('reads the groundingChunks shape, deduping and dropping a non-http source', () => {
    expect(extractCitations(CHUNK_RESPONSE)).toEqual([
      { title: 'example.com', uri: 'https://www.example.com/sri-lanka' },
      { title: 'travel.state.gov', uri: 'https://travel.state.gov/sri-lanka' },
    ]);
  });

  it('reads the url_citation annotation shape', () => {
    expect(extractCitations(STEP_RESPONSE)).toEqual([
      { title: 'example.org', uri: 'https://www.example.org/kandy-weather' },
    ]);
  });

  it('falls back to the host when a citation carries no title', () => {
    const response = {
      candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.example.net/x' } }] } }],
    };
    expect(extractCitations(response)).toEqual([{ title: 'example.net', uri: 'https://www.example.net/x' }]);
  });

  it('caps the source list', () => {
    const chunks = Array.from({ length: 9 }, (_, index) => ({ web: { uri: `https://e${index}.example`, title: `t${index}` } }));
    const response = { candidates: [{ groundingMetadata: { groundingChunks: chunks } }] };
    expect(extractCitations(response)).toHaveLength(5);
  });

  it('returns nothing when the response carries no grounding at all', () => {
    expect(extractCitations({ text: 'unburdened' })).toEqual([]);
  });
});

describe('extractText', () => {
  it('prefers the SDK text convenience', () => {
    expect(extractText(CHUNK_RESPONSE)).toBe('Sri Lanka is best visited between December and March.');
  });

  it('joins candidate parts when there is no top-level text', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'one ' }, { text: 'two' }] } }] })).toBe('one two');
  });
});

describe('generateGrounded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  // Left behind, this placeholder is read by any other suite in the same worker
  // as if the service were configured — which is how a live test can end up
  // talking to the real provider with a fake key.
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('asks for grounding, prose output, and no JSON schema', async () => {
    mockGenerateContent.mockResolvedValue(CHUNK_RESPONSE);

    const result = await generateGrounded({ prompt: 'best time to visit Sri Lanka' });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.tools).toEqual([{ googleSearch: {} }]);
    expect(call.config.responseSchema).toBeUndefined();
    // Pinned rather than left unset: with no schema the model takes its cue from
    // the prompt, and a prompt read as "structured" produced a JSON object
    // answered from memory — the search never ran, so no sources came back.
    expect(call.config.responseMimeType).toBe('text/plain');
    expect(result.text).toContain('December and March');
    expect(result.citations).toHaveLength(2);
  });

  it('refuses to return an answer that arrived without a single usable source', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Trust me, go in June.', candidates: [{ groundingMetadata: {} }] });

    await expect(generateGrounded({ prompt: 'best time to visit Kandy' })).rejects.toThrow('no grounding sources');
  });

  it('reports a provider failure as a bad gateway with its failure category', async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    await expect(generateGrounded({ prompt: 'best time to visit Kandy' })).rejects.toMatchObject({
      statusCode: 502,
      aiFailureCategory: 'provider',
    });
  });

  it('reports a timeout as its own failure category', async () => {
    mockGenerateContent.mockImplementation(() => new Promise(() => {}));

    await expect(generateGrounded({ prompt: 'best time to visit Kandy', timeoutMs: 5 })).rejects.toMatchObject({
      aiFailureCategory: 'timeout',
    });
  });

  it('refuses to start without a configured key', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateGrounded({ prompt: 'best time to visit Kandy' })).rejects.toThrow('not configured');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

const OPENAI_RESPONSE = {
  status: 'completed',
  output: [
    { type: 'web_search_call', status: 'completed' },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'Ella is cooler than the coast, best from January to April.',
          annotations: [
            { type: 'url_citation', url: 'https://www.example.net/ella', title: 'Ella guide' },
            { type: 'url_citation', url: 'https://www.example.net/ella', title: 'Ella guide' },
          ],
        },
      ],
    },
  ],
};

const openaiReply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('generateGrounded with OpenAI as the primary provider', () => {
  let mockFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GEMINI_API_KEY = 'test-key';
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    vi.unstubAllGlobals();
  });

  it('reads the answer and deduped sources from the OpenAI output shape', async () => {
    mockFetch.mockResolvedValue(openaiReply(OPENAI_RESPONSE));

    const result = await generateGrounded({ prompt: 'best time to visit Ella' });

    expect(result).toEqual({
      text: 'Ella is cooler than the coast, best from January to April.',
      citations: [{ title: 'Ella guide', uri: 'https://www.example.net/ella' }],
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('forces a web search on every call', async () => {
    mockFetch.mockResolvedValue(openaiReply(OPENAI_RESPONSE));

    await generateGrounded({ prompt: 'best time to visit Ella' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.tool_choice).toBe('required');
  });

  it('falls back to Gemini grounding when OpenAI fails', async () => {
    mockFetch.mockResolvedValue(openaiReply({ error: { message: 'overloaded' } }, 503));
    mockGenerateContent.mockResolvedValue(CHUNK_RESPONSE);

    const result = await generateGrounded({ prompt: 'best time to visit Sri Lanka' });

    expect(result.text).toContain('December and March');
  });

  it('falls back to Gemini when OpenAI answers without a source', async () => {
    mockFetch.mockResolvedValue(openaiReply({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'June.' }] }] }));
    mockGenerateContent.mockResolvedValue(CHUNK_RESPONSE);

    const result = await generateGrounded({ prompt: 'best time to visit Sri Lanka' });

    expect(result.citations).toHaveLength(2);
  });

  it('reports the OpenAI failure when no Gemini key is set', async () => {
    delete process.env.GEMINI_API_KEY;
    mockFetch.mockResolvedValue(openaiReply({ error: { message: 'bad request' } }, 400));

    await expect(generateGrounded({ prompt: 'best time to visit Kandy' })).rejects.toMatchObject({
      statusCode: 502,
      aiFailureCategory: 'provider',
    });
  });

  it('skips the backup when the budget is too small to use', async () => {
    mockFetch.mockResolvedValue(openaiReply({ error: { message: 'overloaded' } }, 503));

    await expect(generateGrounded({ prompt: 'best time to visit Kandy', timeoutMs: 1_500 })).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
