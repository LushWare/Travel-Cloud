import { z } from 'zod';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

// ─── The visitor's conversation, server-side ──────────────────────────────
// The public turn used to be stateless: the browser resent up to 20 messages
// and its own `shownPackageIds` on every request, and the server kept nothing.
// That is enough to answer a question and not enough to take a booking, because
// a draft, a confirmation and "did we already write" all have to survive between
// turns — and a confirmation the client supplies is not a confirmation.
//
// This module is the whole of the persistence. Everything it exports catches its
// own failures and reports `{ ok: false }` rather than throwing: the turn must
// keep answering when the store is unreachable, and the caller — not this
// module — decides what a turn without history means. That is deliberately NOT
// the log-and-continue shape of `recordAssistantResolution`, which is sound only
// because telemetry is a fire-and-forget sink.

/** The window the client used to resend. The prompt is unchanged in size. */
export const SESSION_HISTORY_LIMIT = 20;

/** A session untouched for this long is reset the next time it is read. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The booking draft, which is the only structured state a turn keeps. `.strict()`
// so a renamed field is a failure here rather than a silent undefined later, and
// length-capped because every value in it came from a model's reading of a
// visitor's sentence.
const bookingDraftSchema = z
  .object({
    packageId: z.string().max(64).optional(),
    packageTitle: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
    travelDate: z.string().max(10).optional(),
    endDate: z.string().max(10).optional(),
    travelers: z.number().int().min(1).max(50).optional(),
    name: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
  })
  .strict();

/**
 * The stored draft as a plain object, or `{}` for anything that does not match.
 * A draft that cannot be read is treated as absent: the visitor is asked again,
 * which is the only safe direction — a partially-read draft could otherwise
 * submit a field the visitor never confirmed.
 */
export function parseBookingDraft(value) {
  const parsed = bookingDraftSchema.safeParse(value ?? {});
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'Discarded an unreadable booking draft');
    return {};
  }
  return parsed.data;
}

const isExpired = (session) => Date.now() - session.lastSeenAt.getTime() > SESSION_TTL_MS;

/** Clears an expired session in place, keeping its row (and its id) alive. */
async function resetExpiredSession(sessionId) {
  return prisma.$transaction(async (tx) => {
    await tx.assistantMessage.deleteMany({ where: { sessionId } });
    return tx.assistantSession.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: new Date(),
        shownPackageIds: [],
        bookingDraft: null,
        bookingStatus: null,
        bookingId: null,
        bookingAskedTurn: null,
        turnCount: 0,
      },
    });
  });
}

/**
 * The conversation so far, plus the ordinal of the turn being served.
 *
 * `thisTurn` exists so the booking confirmation can be anchored to a turn
 * number rather than to a message position: "is this the visitor's very next
 * message after we asked?" is an equality, and message seqs advance by two per
 * turn, which is exactly the kind of arithmetic that rots.
 */
export async function loadSession(sessionId) {
  try {
    const existing = await prisma.assistantSession.findUnique({ where: { id: sessionId } });

    if (!existing) {
      const created = await prisma.assistantSession.create({
        data: { id: sessionId, lastSeenAt: new Date() },
      });
      return { ok: true, session: { ...created, bookingDraft: {} }, messages: [], thisTurn: 1 };
    }

    if (isExpired(existing)) {
      const reset = await resetExpiredSession(sessionId);
      return { ok: true, session: { ...reset, bookingDraft: {} }, messages: [], thisTurn: 1 };
    }

    // Newest-first with a cap, then reversed: the cap has to be applied to the
    // end of the conversation, not the start.
    const recent = await prisma.assistantMessage.findMany({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      take: SESSION_HISTORY_LIMIT,
      select: { id: true, seq: true, role: true, content: true },
    });

    return {
      ok: true,
      session: { ...existing, bookingDraft: parseBookingDraft(existing.bookingDraft) },
      messages: recent.reverse(),
      thisTurn: existing.turnCount + 1,
    };
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to read the assistant session');
    return { ok: false };
  }
}

/**
 * Appends one turn's messages. `skipDuplicates` is the idempotency: a retried
 * turn re-sends the same message ids, and those rows are already there.
 */
export async function appendTurn(sessionId, messages) {
  try {
    const latest = await prisma.assistantMessage.aggregate({
      where: { sessionId },
      _max: { seq: true },
    });
    const base = latest._max.seq ?? 0;

    await prisma.assistantMessage.createMany({
      data: messages.map((message, index) => ({
        id: message.id,
        sessionId,
        seq: base + index + 1,
        role: message.role,
        content: message.content,
      })),
      skipDuplicates: true,
    });

    return { ok: true, nextSeq: base + messages.length + 1 };
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to append to the assistant session');
    return { ok: false };
  }
}

/** Partial update. A key left out is untouched; `null` clears a nullable field. */
export async function updateSession(sessionId, patch) {
  const data = { lastSeenAt: patch.lastSeenAt ?? new Date() };
  if (patch.shownPackageIds !== undefined) data.shownPackageIds = patch.shownPackageIds;
  if (patch.bookingStatus !== undefined) data.bookingStatus = patch.bookingStatus;
  if (patch.bookingId !== undefined) data.bookingId = patch.bookingId;
  if (patch.bookingAskedTurn !== undefined) data.bookingAskedTurn = patch.bookingAskedTurn;
  if (patch.turnCount !== undefined) data.turnCount = patch.turnCount;
  if (patch.bookingDraft !== undefined) {
    data.bookingDraft = Object.keys(patch.bookingDraft).length
      ? parseBookingDraft(patch.bookingDraft)
      : null;
  }

  try {
    await prisma.assistantSession.update({ where: { id: sessionId }, data });
    return { ok: true };
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to update the assistant session');
    return { ok: false };
  }
}

/** Test seam: removes every session and message. Never called from a request. */
export async function _resetSessionStore() {
  await prisma.assistantMessage.deleteMany({});
  await prisma.assistantSession.deleteMany({});
}
