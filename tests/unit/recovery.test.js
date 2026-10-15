import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSnapshotAction, pickRecoveryCandidate, coverage, snapshotsToPrune, MERGE_WINDOW_MS } from '../../src/core/recovery.js';

const last = { fingerprint: 'f1', tabCount: 10, windowCount: 2, createdAt: 1000, sessionId: 1 };
const opts = { now: 2000, sessionId: 1 };

test('first snapshot is created', () => assert.equal(decideSnapshotAction(null, { fingerprint: 'x' }, opts), 'create'));
test('identical content is skipped', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f1', tabCount: 10, windowCount: 2 }, opts), 'skip'));
test('small change soon after updates in place', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f2', tabCount: 11, windowCount: 2 }, opts), 'update'));
test('closing a window keeps the previous snapshot', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f2', tabCount: 10, windowCount: 1 }, opts), 'create'));
test('closing several tabs keeps the previous snapshot', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f2', tabCount: 8, windowCount: 2 }, opts), 'create'));
test('old snapshot gets a new record', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f2', tabCount: 11, windowCount: 2 }, { now: 1000 + MERGE_WINDOW_MS, sessionId: 1 }), 'create'));
test('new browser session never overwrites the old one', () => assert.equal(decideSnapshotAction(last, { fingerprint: 'f2', tabCount: 11, windowCount: 2 }, { now: 2000, sessionId: 2 }), 'create'));

test('candidate is the largest snapshot of the most recent previous session', () => {
  const snaps = [
    { id: 'a', sessionId: 1, tabCount: 50, updatedAt: 10 },
    { id: 'b', sessionId: 2, tabCount: 20, updatedAt: 20 },
    { id: 'c', sessionId: 2, tabCount: 25, updatedAt: 30 },
    { id: 'd', sessionId: 2, tabCount: 3, updatedAt: 40 }, // shrinking during shutdown
    { id: 'e', sessionId: 3, tabCount: 99, updatedAt: 50 }, // current session
  ];
  assert.equal(pickRecoveryCandidate(snaps, 3).id, 'c');
  assert.equal(pickRecoveryCandidate([{ id: 'x', sessionId: 3, tabCount: 1, updatedAt: 1 }], 3), null);
});

test('coverage measures how much of a snapshot is already open', () => {
  const snap = { windows: [{ tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/#x' }] }] };
  assert.equal(coverage(snap, ['https://a.com', 'https://b.com/']), 1);
  assert.equal(coverage(snap, ['https://a.com']), 0.5);
  assert.equal(coverage({ windows: [] }, []), 1);
});

test('prune keeps the newest N and the pending snapshot', () => {
  const snaps = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, updatedAt: n }));
  assert.deepEqual(snapshotsToPrune(snaps, 2, 's1').sort(), ['s2', 's3']);
});
