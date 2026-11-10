// Run with: node --test Services/seed-demo/lib/clients.test.mjs (needs each service's node_modules)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryClosedConnections } from './clients.mjs';

const closed = () => Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });

const fakeClient = (failures, error = closed) => {
  let calls = 0;
  return {
    calls: () => calls,
    leadPricing: {
      async findUnique() {
        calls += 1;
        if (calls <= failures) throw error();
        return { id: 'p1' };
      },
    },
  };
};

test('returns the row after the pooler drops the connection once', async () => {
  const client = fakeClient(1);
  const db = retryClosedConnections(client, { delayMs: 0 });

  const row = await db.leadPricing.findUnique({ where: { id: 'p1' } });

  assert.equal(row.id, 'p1');
  assert.equal(client.calls(), 2);
});

test('gives up after three closed connections in a row', async () => {
  const client = fakeClient(5);
  const db = retryClosedConnections(client, { delayMs: 0 });

  await assert.rejects(db.leadPricing.findUnique({}), /closed the connection/);
  assert.equal(client.calls(), 3);
});

test('does not retry a real query error', async () => {
  const client = fakeClient(1, () => Object.assign(new Error('Invalid value for argument'), { code: 'P2009' }));
  const db = retryClosedConnections(client, { delayMs: 0 });

  await assert.rejects(db.leadPricing.findUnique({}), /Invalid value/);
  assert.equal(client.calls(), 1);
});
