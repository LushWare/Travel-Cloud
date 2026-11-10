// Run with: node --test Services/seed-demo/agencies.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENCIES, CONSULTANT, agencyEmail, selectAgencies } from './lib/agencies.mjs';
import { id, makeCounters, ownedPrefix, setAgencyIndex } from './lib/ids.mjs';
import { DEMO_ID_PREFIXES } from './lib/reset.mjs';

const like = (pattern, value) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/%/g, '.*')}$`).test(value);

test('builds three agencies with lush-demo holding the existing data', () => {
  assert.deepEqual(AGENCIES.map((a) => a.slug), ['lush-demo', 'acme-tours', 'globe-dmc']);
  assert.equal(AGENCIES[0].id, '00000000-0000-4000-8000-000000000001');
  assert.equal(new Set(AGENCIES.map((a) => a.id)).size, 3);
});

test('puts the agency into every id', () => {
  assert.equal(id('lead', 42, 0), '2a000000-0000-4000-8000-000000000042');
  assert.equal(id('lead', 42, 1), '2a000001-0000-4000-8000-000000000042');
});

test('gives the same row a different id in each agency', () => {
  setAgencyIndex(2);
  const globe = makeCounters().next('invoice');
  setAgencyIndex(0);
  const demo = makeCounters().next('invoice');

  assert.notEqual(globe, demo);
});

test('clears only the current agency\'s rows', () => {
  setAgencyIndex(1);
  const prefix = ownedPrefix('booking');
  setAgencyIndex(0);

  assert.equal(prefix, '3b000001-');
  assert.ok(!id('booking', 5, 0).startsWith(prefix));
});

test('--reset finds the rows of every agency', () => {
  for (const agency of AGENCIES) {
    assert.ok(like(`${DEMO_ID_PREFIXES.lead}%`, id('lead', 7, agency.index)), agency.slug);
  }
});

test('--reset leaves ids outside the seed alone', () => {
  assert.ok(!like(`${DEMO_ID_PREFIXES.lead}%`, '2a1b2c3d-0000-4000-8000-000000000001'));
  assert.ok(!like(`${DEMO_ID_PREFIXES.lead}%`, 'a0000000-0000-4000-8000-000000000001'));
});

test('keeps lush-demo staff emails as they are', () => {
  assert.equal(agencyEmail('nuwan@lushtravelcloud.com', AGENCIES[0]), 'nuwan@lushtravelcloud.com');
});

test('gives other agencies their own staff accounts', () => {
  assert.equal(agencyEmail('nuwan@lushtravelcloud.com', AGENCIES[1]), 'nuwan+acme-tours@lushtravelcloud.com');
});

test('puts the consultant in two agencies with a different role in each', () => {
  assert.deepEqual(CONSULTANT.memberships.map((m) => [m.agency, m.role]), [['acme-tours', 'salesRep'], ['globe-dmc', 'admin']]);
});

test('seeds only the agencies asked for', () => {
  assert.deepEqual(selectAgencies(['acme-tours']).map((a) => a.slug), ['acme-tours']);
  assert.throws(() => selectAgencies(['nope']), /Unknown agency/);
});
