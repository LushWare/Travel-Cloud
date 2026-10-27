import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireInternalToken } from '../internalToken.js';

describe('requireInternalToken', () => {
  beforeEach(() => {
    process.env.INTERNAL_EVENTS_TOKEN = 'internal-test-token';
  });

  it('rejects a missing token', () => {
    const next = vi.fn();
    requireInternalToken({ get: () => undefined }, {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it('rejects a wrong token', () => {
    const next = vi.fn();
    requireInternalToken({ get: () => 'wrong-token' }, {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it('allows the configured service token', () => {
    const next = vi.fn();
    requireInternalToken({ get: () => 'internal-test-token' }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});