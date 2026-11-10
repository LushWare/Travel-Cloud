import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { refreshSession } = vi.hoisted(() => ({
  refreshSession: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../../db/client.js', () => ({ default: { refreshSession } }));

import { createSession, consumeSession, revokeSessionByToken, revokeUserSessions } from '../session.service.js';

const NOW = new Date('2026-11-09T10:00:00.000Z');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const session = (over = {}) => ({
  id: 's-1', userId: 'user-1', familyId: 'fam-1', usedAt: null, revokedAt: null,
  expiresAt: new Date(NOW.getTime() + 60_000), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  refreshSession.updateMany.mockResolvedValue({ count: 1 });
  delete process.env.REFRESH_TOKEN_TTL_DAYS;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSession', () => {
  it('stores only a hash of the refresh token, never the token itself', async () => {
    const { token } = await createSession('user-1');

    const { data } = refreshSession.create.mock.calls[0][0];
    expect(data.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(data)).not.toContain(token);
  });

  it('expires the session after 7 days by default', async () => {
    const { expiresAt } = await createSession('user-1');

    expect(expiresAt.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it('keeps the given family id when rotating', async () => {
    await createSession('user-1', { familyId: 'fam-9' });

    expect(refreshSession.create.mock.calls[0][0].data.familyId).toBe('fam-9');
  });

  it('issues a different token every time', async () => {
    const a = await createSession('user-1');
    const b = await createSession('user-1');

    expect(a.token).not.toBe(b.token);
  });
});

describe('consumeSession', () => {
  it('returns the owner and family of a valid unused token', async () => {
    refreshSession.findUnique.mockResolvedValue(session());

    expect(await consumeSession('tok')).toEqual({ userId: 'user-1', familyId: 'fam-1' });
  });

  it('looks the session up by the hash of the presented token', async () => {
    refreshSession.findUnique.mockResolvedValue(session());

    await consumeSession('tok');

    expect(refreshSession.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('tok') } });
  });

  it('marks the token as used so it cannot be replayed later', async () => {
    refreshSession.findUnique.mockResolvedValue(session());

    await consumeSession('tok');

    expect(refreshSession.updateMany).toHaveBeenCalledWith({ where: { id: 's-1', usedAt: null }, data: { usedAt: NOW } });
  });

  it.each([undefined, '', 42])('returns null for a missing or malformed token (%s)', async (token) => {
    expect(await consumeSession(token)).toBeNull();
    expect(refreshSession.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for an unknown token', async () => {
    refreshSession.findUnique.mockResolvedValue(null);

    expect(await consumeSession('tok')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    refreshSession.findUnique.mockResolvedValue(session({ expiresAt: NOW }));

    expect(await consumeSession('tok')).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    refreshSession.findUnique.mockResolvedValue(session({ revokedAt: new Date(NOW.getTime() - 1000) }));

    expect(await consumeSession('tok')).toBeNull();
  });

  it('allows a second tab to reuse the token within 30 seconds', async () => {
    refreshSession.findUnique.mockResolvedValue(session({ usedAt: new Date(NOW.getTime() - 29_000) }));

    expect(await consumeSession('tok')).toEqual({ userId: 'user-1', familyId: 'fam-1' });
  });

  it('rejects a token replayed after 30 seconds', async () => {
    refreshSession.findUnique.mockResolvedValue(session({ usedAt: new Date(NOW.getTime() - 31_000) }));

    expect(await consumeSession('tok')).toBeNull();
  });

  it('revokes the whole login family when a used token is replayed', async () => {
    refreshSession.findUnique.mockResolvedValue(session({ usedAt: new Date(NOW.getTime() - 31_000) }));

    await consumeSession('tok');

    expect(refreshSession.updateMany).toHaveBeenCalledWith({ where: { familyId: 'fam-1', revokedAt: null }, data: { revokedAt: NOW } });
  });
});

describe('revoking', () => {
  it('revokes the family of the presented token on logout', async () => {
    refreshSession.findUnique.mockResolvedValue(session());

    await revokeSessionByToken('tok');

    expect(refreshSession.updateMany).toHaveBeenCalledWith({ where: { familyId: 'fam-1', revokedAt: null }, data: { revokedAt: NOW } });
  });

  it('does nothing on logout without a token', async () => {
    await revokeSessionByToken(undefined);

    expect(refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('revokes every session of a user', async () => {
    await revokeUserSessions('user-1');

    expect(refreshSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: NOW } });
  });
});
