import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  assistantSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  assistantMessage: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ default: mockPrisma }));

const { loadSession, appendTurn, updateSession, parseBookingDraft, SESSION_TTL_MS } = await import(
  '../assistantSession.js'
);

const NOW = Date.now();

const sessionRow = (overrides = {}) => ({
  id: 'session-1',
  createdAt: new Date(NOW - 1000),
  lastSeenAt: new Date(NOW),
  shownPackageIds: [],
  bookingDraft: null,
  bookingStatus: null,
  bookingId: null,
  bookingAskedTurn: null,
  turnCount: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.assistantSession.update.mockResolvedValue(sessionRow());
  mockPrisma.assistantMessage.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.$transaction.mockImplementation(async (work) => work(mockPrisma));
});

describe('loadSession', () => {
  it('creates the session on first use and reports the first turn', async () => {
    mockPrisma.assistantSession.findUnique.mockResolvedValue(null);
    mockPrisma.assistantSession.create.mockResolvedValue(sessionRow());

    const stored = await loadSession('session-1');

    expect(mockPrisma.assistantSession.create).toHaveBeenCalledWith({
      data: { id: 'session-1', lastSeenAt: expect.any(Date) },
    });
    expect(stored).toMatchObject({ ok: true, messages: [], thisTurn: 1 });
    expect(stored.session.bookingDraft).toEqual({});
  });

  it('returns the recent history oldest-first, capped at the window', async () => {
    mockPrisma.assistantSession.findUnique.mockResolvedValue(sessionRow({ turnCount: 4 }));
    // Prisma is asked for newest-first so the cap applies to the END of the
    // conversation rather than the beginning.
    mockPrisma.assistantMessage.findMany.mockResolvedValue([
      { id: 'm3', seq: 6, role: 'assistant', content: 'third' },
      { id: 'm2', seq: 5, role: 'user', content: 'second' },
      { id: 'm1', seq: 1, role: 'user', content: 'first' },
    ]);

    const stored = await loadSession('session-1');

    expect(mockPrisma.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'session-1' }, orderBy: { seq: 'desc' }, take: 20 }),
    );
    expect(stored.messages.map((message) => message.content)).toEqual(['first', 'second', 'third']);
    // The turn being served, not the last completed one.
    expect(stored.thisTurn).toBe(5);
  });

  it('resets a session that has expired instead of replaying it', async () => {
    mockPrisma.assistantSession.findUnique.mockResolvedValue(
      sessionRow({ lastSeenAt: new Date(NOW - SESSION_TTL_MS - 1), turnCount: 9, shownPackageIds: ['p-1'] }),
    );

    const stored = await loadSession('session-1');

    expect(mockPrisma.assistantMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'session-1' } });
    expect(stored).toMatchObject({ ok: true, messages: [], thisTurn: 1 });
  });

  it('reports failure rather than throwing when the store cannot be read', async () => {
    mockPrisma.assistantSession.findUnique.mockRejectedValue(new Error('database unavailable'));

    await expect(loadSession('session-1')).resolves.toEqual({ ok: false });
  });
});

describe('appendTurn', () => {
  it('continues the sequence and skips messages it already has', async () => {
    mockPrisma.assistantMessage.aggregate.mockResolvedValue({ _max: { seq: 4 } });
    mockPrisma.assistantMessage.createMany.mockResolvedValue({ count: 2 });

    const appended = await appendTurn('session-1', [
      { id: 'm5', role: 'user', content: 'book it' },
      { id: 'm5-a', role: 'assistant', content: 'Ready.' },
    ]);

    expect(mockPrisma.assistantMessage.createMany).toHaveBeenCalledWith({
      data: [
        { id: 'm5', sessionId: 'session-1', seq: 5, role: 'user', content: 'book it' },
        { id: 'm5-a', sessionId: 'session-1', seq: 6, role: 'assistant', content: 'Ready.' },
      ],
      // The idempotency: a retried turn re-sends the same ids and appends nothing.
      skipDuplicates: true,
    });
    expect(appended).toEqual({ ok: true, nextSeq: 7 });
  });

  it('reports failure rather than throwing when the append cannot be written', async () => {
    mockPrisma.assistantMessage.aggregate.mockRejectedValue(new Error('database unavailable'));

    await expect(appendTurn('session-1', [{ id: 'm1', role: 'user', content: 'hi' }])).resolves.toEqual({
      ok: false,
    });
  });
});

describe('updateSession', () => {
  it('clears a nullable field with null rather than leaving it out', async () => {
    await updateSession('session-1', { bookingStatus: null, bookingId: null, bookingAskedTurn: null });

    expect(mockPrisma.assistantSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({ bookingStatus: null, bookingId: null, bookingAskedTurn: null }),
    });
  });

  it('stores an empty draft as no draft at all', async () => {
    await updateSession('session-1', { bookingDraft: {} });

    expect(mockPrisma.assistantSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({ bookingDraft: null }),
    });
  });
});

describe('parseBookingDraft', () => {
  it('keeps a readable draft and discards one it cannot trust', () => {
    expect(parseBookingDraft({ packageId: 'p-1', travelers: 2 })).toEqual({ packageId: 'p-1', travelers: 2 });
    // A draft that does not match is treated as absent, so the visitor is asked
    // again rather than a half-read value reaching a booking.
    expect(parseBookingDraft({ email: 'ana@example.com', sneaky: 'extra' })).toEqual({});
    expect(parseBookingDraft({ travelers: 0 })).toEqual({});
    expect(parseBookingDraft(null)).toEqual({});
  });
});
