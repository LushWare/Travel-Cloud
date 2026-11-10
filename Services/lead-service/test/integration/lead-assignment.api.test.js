import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mock prisma (no real DB) ────────────────────────────────────────
// A round-robin settings row that mutates in place, so repeated calls
// through the mocked $transaction observe each other's writes — this
// exercises the read-then-increment arithmetic end to end via HTTP, though
// it cannot substitute for a real-DB test of Postgres transaction isolation
// under true concurrency (see the plan's manual verification step for that).
const { mockPrisma, settingsRow } = vi.hoisted(() => {
  const settingsRow = {
    id: 'settings-1', assignmentMode: 'auto', autoStrategy: 'round_robin',
    enabledSalesRepIds: ['rep-a', 'rep-b', 'rep-c'], roundRobinIndex: 0,
  };
  let nextLeadId = 1;
  const leadsById = new Map();
  const mockPrisma = {
    lead: {
      create: vi.fn(async ({ data }) => {
        const lead = { id: `lead-${nextLeadId++}`, ...data, packageSelections: [] };
        leadsById.set(lead.id, lead);
        return lead;
      }),
      findUnique: vi.fn(async ({ where }) => leadsById.get(where.id)),
      update: vi.fn(async ({ data }) => ({ ...data })),
    },
    settings: {
      upsert: vi.fn(async () => ({ ...settingsRow })),
      update: vi.fn(async ({ data }) => {
        settingsRow.roundRobinIndex += data.roundRobinIndex.increment;
        return { ...settingsRow };
      }),
    },
    $transaction: vi.fn(async (fn) => fn(mockPrisma)),
    $connect: vi.fn(),
  };
  return { mockPrisma, settingsRow };
});

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma }));

const { default: serviceApp } = await import('../../src/app.js');
const { default: express } = await import('express');

const TEST_AGENCY = '11111111-1111-4111-8111-111111111111';
// Requests reach the service with the agency the gateway took from the login.
const app = express().use((req, _res, next) => {
  req.headers['x-tenant-id'] ??= TEST_AGENCY;
  next();
}, serviceApp);

function authHeaders(overrides = {}) {
  return {
    'x-user-id': overrides.id || 'admin-1',
    'x-user-role': overrides.role || 'admin',
    'x-user-email': overrides.email || 'admin@test.com',
    'x-user-name': overrides.name || 'Test Admin',
    'x-user-permissions': JSON.stringify(overrides.permissions || []),
    'x-user-is-super-admin': String(overrides.isSuperAdmin ?? false),
  };
}

beforeEach(() => {
  settingsRow.roundRobinIndex = 0;
  mockPrisma.lead.create.mockClear();
  mockPrisma.settings.upsert.mockClear();
  mockPrisma.settings.update.mockClear();
});

describe('POST /leads — round-robin auto-assignment', () => {
  it('assigns each rep in order and wraps around, one increment per lead created', async () => {
    const reps = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/leads')
        .set(authHeaders())
        .send({ name: `Lead ${i}`, email: `lead${i}@test.com` });
      expect(res.status).toBe(201);
      reps.push(res.body.data.assignedToId);
    }

    expect(reps).toEqual(['rep-a', 'rep-b', 'rep-c', 'rep-a', 'rep-b']);
    expect(mockPrisma.settings.update).toHaveBeenCalledTimes(5);
  });
});
