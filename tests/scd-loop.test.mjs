import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLoop } from '../dist/lib/scd.js';

test('ignores a loop that covers the whole track within the 0.5 second boundary', () => {
  assert.equal(normalizeLoop({ start: 0, end: 9900 }, 10000, 10000), null);
  assert.equal(normalizeLoop({ start: 5000, end: 10000 }, 10000, 10000), null);
});

test('keeps a loop when either edge has more than 0.5 seconds outside it', () => {
  assert.deepEqual(normalizeLoop({ start: 5001, end: 19000 }, 20000, 10000), { start: 5001, end: 19000 });
  assert.deepEqual(normalizeLoop({ start: 0, end: 6000 }, 20000, 10000), { start: 0, end: 6000 });
});

test('ignores loop segments shorter than 0.5 seconds', () => {
  assert.equal(normalizeLoop({ start: 6000, end: 10999 }, 20000, 10000), null);
  assert.deepEqual(normalizeLoop({ start: 6000, end: 11000 }, 20000, 10000), { start: 6000, end: 11000 });
});
