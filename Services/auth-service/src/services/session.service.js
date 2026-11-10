import crypto from 'node:crypto';
import prisma from '../db/client.js';

// Two tabs refreshing at the same moment both present the same token; that is not theft.
const REUSE_GRACE_MS = 30 * 1000;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const ttlMs = () => (parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 7) * 24 * 60 * 60 * 1000;

export async function createSession(userId, { familyId = crypto.randomUUID(), tenantId, ipAddress, userAgent } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs());
  await prisma.refreshSession.create({
    data: { userId, familyId, tenantId, tokenHash: hash(token), expiresAt, ipAddress, userAgent },
  });
  return { token, expiresAt };
}

export const revokeFamily = (familyId) =>
  prisma.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });

export const revokeUserSessions = (userId) =>
  prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

/**
 * Marks a refresh token as used and returns its owner. Returns null for an unknown,
 * expired or revoked token. Presenting an already-used token after the grace window
 * means it was copied, so the whole login family is revoked.
 */
export async function consumeSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash: hash(token) } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  if (session.usedAt) {
    if (Date.now() - session.usedAt.getTime() > REUSE_GRACE_MS) {
      await revokeFamily(session.familyId);
      return null;
    }
  } else {
    await prisma.refreshSession.updateMany({ where: { id: session.id, usedAt: null }, data: { usedAt: new Date() } });
  }
  return { userId: session.userId, familyId: session.familyId, tenantId: session.tenantId };
}

export async function revokeSessionByToken(token) {
  if (typeof token !== 'string' || !token) return;
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash: hash(token) } });
  if (session) await revokeFamily(session.familyId);
}
