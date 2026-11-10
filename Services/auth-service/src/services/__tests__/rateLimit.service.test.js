import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));

vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../config/logger.js', () => ({ default: { warn: vi.fn() } }));

import { clear, hit } from '../rateLimit.service.js';

const NOW = new Date('2026-11-09T10:00:00.000Z');
const LIMIT = { limit: 3, windowSeconds: 900 };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sqlValues = (call) => call.slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  prismaMock.$executeRaw.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const respondWith = (hits, secondsLeft = 600) =>
  prismaMock.$queryRaw.mockResolvedValue([{ hits, resetAt: new Date(NOW.getTime() + secondsLeft * 1000) }]);

describe('hit', () => {
  it('allows attempts up to the limit', async () => {
    respondWith(3);

    expect((await hit('login-ip', '1.2.3.4', LIMIT)).allowed).toBe(true);
  });

  it('blocks the attempt after the limit', async () => {
    respondWith(4);

    expect((await hit('login-ip', '1.2.3.4', LIMIT)).allowed).toBe(false);
  });

  it('says how long to wait until the window resets', async () => {
    respondWith(4, 125);

    expect((await hit('login-ip', '1.2.3.4', LIMIT)).retryAfterSeconds).toBe(125);
  });

  it('never asks to wait less than one second', async () => {
    respondWith(4, 0);

    expect((await hit('login-ip', '1.2.3.4', LIMIT)).retryAfterSeconds).toBe(1);
  });

  it('stores a hash of the email, never the email itself', async () => {
    respondWith(1);

    await hit('login-account', 'Alice@Test.com ', LIMIT);

    const values = sqlValues(prismaMock.$queryRaw.mock.calls[0]);
    expect(values[0]).toBe(`login-account:${sha256('alice@test.com')}`);
    expect(JSON.stringify(values)).not.toContain('alice');
  });

  it('counts the same email in different letter case as one account', async () => {
    respondWith(1);

    await hit('login-account', 'ALICE@test.com', LIMIT);
    await hit('login-account', 'alice@test.com', LIMIT);

    const [first, second] = prismaMock.$queryRaw.mock.calls.map((call) => sqlValues(call)[0]);
    expect(first).toBe(second);
  });

  it('passes the window length to the database', async () => {
    respondWith(1);

    await hit('login-ip', '1.2.3.4', LIMIT);

    expect(sqlValues(prismaMock.$queryRaw.mock.calls[0])).toContain(900);
  });

  it('occasionally removes expired counters', async () => {
    Math.random.mockReturnValue(0.001);
    respondWith(1);

    await hit('login-ip', '1.2.3.4', LIMIT);

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does not fail the attempt when the cleanup fails', async () => {
    Math.random.mockReturnValue(0.001);
    prismaMock.$executeRaw.mockRejectedValue(new Error('db down'));
    respondWith(1);

    await expect(hit('login-ip', '1.2.3.4', LIMIT)).resolves.toMatchObject({ allowed: true });
  });
});

describe('clear', () => {
  it('deletes the counter for the same hashed key', async () => {
    await clear('login-account', 'alice@test.com');

    expect(sqlValues(prismaMock.$executeRaw.mock.calls[0])).toEqual([`login-account:${sha256('alice@test.com')}`]);
  });
});
