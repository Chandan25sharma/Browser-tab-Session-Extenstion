import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups, pickKeeper, planDuplicateClose } from '../../src/core/duplicates.js';

const tab = (id, url, extra = {}) => ({ id, url, title: `T${id}`, active: false, pinned: false, lastAccessed: id, ...extra });

test('groups tabs by normalized URL', () => {
  const groups = findDuplicateGroups([
    tab(1, 'https://github.com/example/project'),
    tab(2, 'https://github.com/example/project#readme'),
    tab(3, 'https://github.com/example/project?utm_source=x'),
    tab(4, 'https://github.com/example/other'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tabs.map((t) => t.id), [1, 2, 3]);
});

test('does not treat matching titles as duplicates', () => {
  const groups = findDuplicateGroups([tab(1, 'https://a.com/1', { title: 'Same' }), tab(2, 'https://a.com/2', { title: 'Same' })]);
  assert.equal(groups.length, 0);
});

test('different query parameters are not duplicates', () => {
  assert.equal(findDuplicateGroups([tab(1, 'https://a.com/?id=1'), tab(2, 'https://a.com/?id=2')]).length, 0);
});

test('tracking stripping can be disabled', () => {
  const tabs = [tab(1, 'https://a.com/'), tab(2, 'https://a.com/?utm_source=x')];
  assert.equal(findDuplicateGroups(tabs).length, 1);
  assert.equal(findDuplicateGroups(tabs, { stripTracking: false }).length, 0);
});

test('keeper prefers active, then pinned, then most recent', () => {
  assert.equal(pickKeeper([tab(1, 'u'), tab(2, 'u', { active: true }), tab(3, 'u', { pinned: true })]).id, 2);
  assert.equal(pickKeeper([tab(1, 'u'), tab(3, 'u', { pinned: true })]).id, 3);
  assert.equal(pickKeeper([tab(1, 'u'), tab(5, 'u')]).id, 5);
});

test('close plan keeps one and never closes pinned or protected tabs', () => {
  const group = { key: 'u', tabs: [tab(1, 'u', { active: true }), tab(2, 'u'), tab(3, 'u', { pinned: true }), tab(4, 'u')] };
  const isProtected = (t) => t.id === 4;
  const plan = planDuplicateClose(group, null, isProtected);
  assert.deepEqual(plan.close, [2]);
  assert.deepEqual(plan.skipped.sort(), [3, 4]);
});

test('close plan honors the review selection', () => {
  const group = { key: 'u', tabs: [tab(1, 'u'), tab(2, 'u'), tab(3, 'u')] };
  assert.deepEqual(planDuplicateClose(group, new Set([1, 3])).close, [2]);
});

test('close plan always keeps at least one tab', () => {
  const group = { key: 'u', tabs: [tab(1, 'u'), tab(2, 'u')] };
  const plan = planDuplicateClose(group, new Set([999]));
  assert.equal(plan.close.length, 1);
});
