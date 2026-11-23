import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './remove-agency.mjs';

test('reports only unless --commit is given', () => {
  assert.equal(parseArgs(['--agency=acme-tours']).commit, false);
});

test('deletes only when --commit is given', () => {
  assert.equal(parseArgs(['--agency=acme-tours', '--commit']).commit, true);
});

test('collects agencies from commas and repeated flags without duplicates', () => {
  assert.deepEqual(
    parseArgs(['--agency=acme-tours, globe-dmc', '--agency=acme-tours', '--agency=test-1']).agencies,
    ['acme-tours', 'globe-dmc', 'test-1'],
  );
});

test('rejects an unknown option instead of ignoring it', () => {
  assert.throws(() => parseArgs(['--agencies=acme-tours']), /Unknown option --agencies=acme-tours/);
});
