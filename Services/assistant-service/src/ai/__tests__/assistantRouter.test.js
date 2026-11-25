import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateStructured } = vi.hoisted(() => ({ mockGenerateStructured: vi.fn() }));
vi.mock('../aiClient.js', () => ({ generateStructured: mockGenerateStructured }));

const { classifyAssistantIntent, decideRouterCommit } = await import('../assistantRouter.js');

const social = {
  intent: 'social',
  confidence: 0.99,
  hasActionableClause: false,
  socialSubtype: 'greeting',
  reasonCode: 'single_social',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASSISTANT_ROUTER_SOCIAL_ENABLED;
  delete process.env.ASSISTANT_ROUTER_OFF_TOPIC_ENABLED;
  delete process.env.ASSISTANT_ROUTER_SOCIAL_THRESHOLD;
  delete process.env.ASSISTANT_ROUTER_OFF_TOPIC_THRESHOLD;
});

describe('decideRouterCommit', () => {
  it('keeps direct classes disabled by default', () => {
    expect(decideRouterCommit(social)).toEqual({ committed: false, reason: 'class_disabled' });
  });

  it('commits an enabled class only at its configured threshold', () => {
    process.env.ASSISTANT_ROUTER_SOCIAL_ENABLED = 'true';
    process.env.ASSISTANT_ROUTER_SOCIAL_THRESHOLD = '0.98';
    expect(decideRouterCommit(social)).toEqual({ committed: true, reason: 'threshold_met' });
    expect(decideRouterCommit({ ...social, confidence: 0.979 })).toEqual({ committed: false, reason: 'below_threshold' });
  });

  it('always abstains from actionable, protected, ambiguous, and resolver-owned intents', () => {
    process.env.ASSISTANT_ROUTER_SOCIAL_ENABLED = 'true';
    expect(decideRouterCommit({ ...social, hasActionableClause: true })).toEqual({ committed: false, reason: 'actionable_clause' });
    for (const intent of ['navigation', 'company_policy', 'travel_general', 'sensitive', 'ambiguous']) {
      expect(decideRouterCommit({ ...social, intent })).toEqual({ committed: false, reason: 'resolver_required' });
    }
  });
});

describe('classifyAssistantIntent', () => {
  it('uses one deterministic 1.5-second model attempt and strict schema validation', async () => {
    mockGenerateStructured.mockResolvedValue(social);
    const result = await classifyAssistantIntent('Hello', 10_000);

    expect(result.classification).toEqual(social);
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0, timeoutMs: 1_500, maxAttempts: 1, maxOutputTokens: 256 }),
    );
  });

  it('bounds the whole classification, backup provider included, by the 1.5-second budget', async () => {
    mockGenerateStructured.mockResolvedValue(social);
    await classifyAssistantIntent('Hello', 900);

    expect(mockGenerateStructured).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 900, deadlineMs: 900 }));
  });

  it('asks OpenAI for the no-reasoning fast model', async () => {
    mockGenerateStructured.mockResolvedValue(social);
    await classifyAssistantIntent('Hello', 10_000);

    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ openaiModel: 'gpt-6-luna', reasoningEffort: 'none' }),
    );
  });

  it('rejects unknown fields rather than leaking them into routing metadata', async () => {
    mockGenerateStructured.mockResolvedValue({ ...social, rawMessage: 'secret' });
    await expect(classifyAssistantIntent('Hello', 10_000)).rejects.toThrow();
  });
});
