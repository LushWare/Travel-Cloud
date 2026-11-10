import { describe, it, expect, vi } from 'vitest';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';
import {
  acknowledgeKeys,
  buildDecisionRows,
  decisionsWorthPersisting,
  loadPriorState,
  markSurfaced,
  recordDecisions,
  statesToMap,
} from '../state.js';

const scope = { actorId: 'rep-1', pageKey: 'leads', scopeFingerprint: '{}' };

describe('decisionsWorthPersisting', () => {
  it('drops the structural layers, which are counters rather than rows', () => {
    const kept = decisionsWorthPersisting([
      { key: 'a', layer: 'L0', decision: 'dropped', reason: 'invalid_shape' },
      { key: 'b', layer: 'L1', decision: 'dropped', reason: 'uncited' },
      { key: 'c', layer: 'L2', decision: 'dropped', reason: 'unauthorized' },
    ]);

    expect(kept).toEqual([]);
  });

  it('keeps everything that got past them, including safety drops', () => {
    const kept = decisionsWorthPersisting([
      { key: 'a', layer: null, decision: 'accepted', reason: 'ok' },
      { key: 'b', layer: 'L5', decision: 'suppressed', reason: 'suppressed_unchanged' },
      { key: 'c', layer: 'L6', decision: 'merged', reason: 'conflict_resolved' },
      { key: 'd', layer: 'L8', decision: 'dropped', reason: 'rejected_safety' },
    ]);

    expect(kept.map((entry) => entry.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles nothing at all', () => {
    expect(decisionsWorthPersisting()).toEqual([]);
    expect(decisionsWorthPersisting([])).toEqual([]);
  });
});

describe('statesToMap', () => {
  it('keys by insight key and normalises missing values', () => {
    const map = statesToMap([
      { insightKey: 'unassigned:record:lead-1', acknowledgedAt: new Date('2026-09-01'), surfacedCount: 3 },
      { insightKey: 'groupedCount:group:leads:destination:Bali' },
    ]);

    expect(map.get('unassigned:record:lead-1')).toEqual({
      acknowledgedAt: new Date('2026-09-01'),
      lastSurfacedAt: null,
      surfacedCount: 3,
      snoozedUntil: null,
      lastMaterialValue: undefined,
    });
    expect(map.get('groupedCount:group:leads:destination:Bali').surfacedCount).toBe(0);
    expect(map.size).toBe(2);
  });

  it('handles an empty result set', () => {
    expect(statesToMap().size).toBe(0);
  });
});

describe('buildDecisionRows', () => {
  const decisions = [
    { key: 'a', layer: null, decision: 'accepted', reason: 'ok', severity: 'critical', score: 0.9, ruleId: 'overdueBy', entityRef: { kind: 'record', id: 'inv-1' } },
    { key: 'b', layer: 'L1', decision: 'dropped', reason: 'uncited' },
  ];

  it('maps the fields and reads entityRef apart', () => {
    const [row] = buildDecisionRows({ decisions, ...scope, requestId: 'req-1', rankingVersion: 'insight-ranking.v1' });

    expect(row).toMatchObject({
      requestId: 'req-1',
      actorId: 'rep-1',
      pageKey: 'leads',
      insightKey: 'a',
      ruleId: 'overdueBy',
      entityKind: 'record',
      entityId: 'inv-1',
      severity: 'critical',
      decision: 'accepted',
      reason: 'ok',
      rankingVersion: 'insight-ranking.v1',
    });
    expect(row.rankScore).toBe(0.9);
  });

  it('excludes the structural drops', () => {
    const rows = buildDecisionRows({ decisions, ...scope });

    expect(rows.map((row) => row.insightKey)).toEqual(['a']);
  });

  it('falls back to the ranked item lookup when a decision carries no severity', () => {
    const rows = buildDecisionRows({
      decisions: [{ key: 'a', layer: null, decision: 'accepted', reason: 'ok' }],
      severityByKey: new Map([['a', 'warning']]),
      scoreByKey: new Map([['a', 0.42]]),
      ...scope,
    });

    expect(rows[0].severity).toBe('warning');
    expect(rows[0].rankScore).toBe(0.42);
  });
});

describe('loadPriorState fails OPEN', () => {
  it('returns an empty map when the read throws, rather than propagating', async () => {
    const prisma = { insightState: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } };

    const state = await loadPriorState({ prisma, ...scope });

    // The worst failure in this design would be an empty panel on a blip, which
    // reads as a quiet page. Showing everything is the safe direction.
    expect(state.size).toBe(0);
  });

  it('returns an empty map when the client is not wired at all', async () => {
    expect((await loadPriorState({ prisma: undefined, ...scope })).size).toBe(0);
    expect((await loadPriorState({ prisma: {}, ...scope })).size).toBe(0);
  });

  it('maps the rows it does get', async () => {
    const prisma = {
      insightState: { findMany: vi.fn().mockResolvedValue([{ insightKey: 'k', surfacedCount: 2, acknowledgedAt: null }]) },
    };

    const state = await loadPriorState({ prisma, ...scope });

    expect(state.get('k').surfacedCount).toBe(2);
  });
});

describe('writes never break the product', () => {
  it('markSurfaced swallows a failure and reports it', async () => {
    const prisma = {
      insightState: { createMany: vi.fn().mockRejectedValue(new Error('write refused')) },
      $executeRaw: vi.fn(),
    };

    const result = await markSurfaced({ prisma, ...scope, keys: ['a'] });

    expect(result).toEqual({ written: 0, failed: true });
  });

  it('markSurfaced inserts once then increments once, not once per key', async () => {
    const prisma = {
      insightState: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
      $executeRaw: vi.fn().mockResolvedValue(3),
    };

    const result = await runWithTenant('11111111-1111-4111-8111-111111111111', () => markSurfaced({ prisma, ...scope, keys: ['a', 'b', 'c'] }));

    expect(prisma.insightState.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(3);
  });

  it('markSurfaced does nothing for an empty key list', async () => {
    const prisma = { insightState: { createMany: vi.fn() } };

    expect(await markSurfaced({ prisma, ...scope, keys: [] })).toEqual({ written: 0 });
    expect(prisma.insightState.createMany).not.toHaveBeenCalled();
  });

  it('recordDecisions swallows a failure', async () => {
    const prisma = { insightDecision: { createMany: vi.fn().mockRejectedValue(new Error('table locked')) } };

    expect(await recordDecisions({ prisma, rows: [{ insightKey: 'a' }] })).toEqual({ written: 0, failed: true });
  });

  it('recordDecisions does nothing when there are no rows', async () => {
    const prisma = { insightDecision: { createMany: vi.fn() } };

    expect(await recordDecisions({ prisma, rows: [] })).toEqual({ written: 0 });
    expect(prisma.insightDecision.createMany).not.toHaveBeenCalled();
  });
});

describe('acknowledgeKeys', () => {
  it('reports how many rows it touched', async () => {
    const prisma = { insightState: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } };

    expect(await acknowledgeKeys({ prisma, ...scope, keys: ['a', 'b'] })).toEqual({ written: 2 });
  });

  it('propagates a failure — an acknowledgement must fail loudly', async () => {
    // Deliberately the opposite policy to the counters: an acknowledgement the
    // operator believes happened and did not is worse than an error.
    const prisma = { insightState: { updateMany: vi.fn().mockRejectedValue(new Error('db down')) } };

    await expect(acknowledgeKeys({ prisma, ...scope, keys: ['a'] })).rejects.toThrow('db down');
  });
});
