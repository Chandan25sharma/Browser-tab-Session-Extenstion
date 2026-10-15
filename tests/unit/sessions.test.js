import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeWindows, planRestore, fingerprint, countTabs, mergeSavedTabs } from '../../src/core/sessions.js';

const chromeTab = (index, url, extra = {}) => ({ index, url, title: url, pinned: false, active: false, groupId: -1, ...extra });

test('serializes normal windows in tab order with pinned, active, and group info', () => {
  const windows = [
    { type: 'normal', incognito: false, tabs: [chromeTab(1, 'https://b.com', { active: true, groupId: 7 }), chromeTab(0, 'https://a.com', { pinned: true })] },
    { type: 'popup', tabs: [chromeTab(0, 'https://popup.com')] },
    { type: 'normal', incognito: true, tabs: [chromeTab(0, 'https://private.com')] },
  ];
  const saved = serializeWindows(windows, [{ id: 7, title: 'Dev', color: 'blue' }]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].tabs, [
    { url: 'https://a.com', title: 'https://a.com', pinned: true, active: false },
    { url: 'https://b.com', title: 'https://b.com', pinned: false, active: true, groupTitle: 'Dev', groupColor: 'blue' },
  ]);
});

test('skips own extension pages and drops windows left empty', () => {
  const saved = serializeWindows([{ type: 'normal', tabs: [chromeTab(0, 'chrome-extension://me/dashboard.html')] }], [], { skipPrefixes: ['chrome-extension://me/'] });
  assert.deepEqual(saved, []);
});

test('uses pendingUrl for tabs still loading', () => {
  const saved = serializeWindows([{ type: 'normal', tabs: [{ index: 0, url: '', pendingUrl: 'https://x.com', title: '', pinned: false, active: true, groupId: -1 }] }]);
  assert.equal(saved[0].tabs[0].url, 'https://x.com');
});

test('planRestore skips unsupported URLs, orders pinned first, keeps one active tab', () => {
  const plan = planRestore([{ tabs: [
    { url: 'https://a.com', title: 'a', pinned: false, active: false },
    { url: 'javascript:void(0)', title: 'bad', pinned: false, active: true },
    { url: 'https://p.com', title: 'p', pinned: true, active: false },
  ] }, { tabs: [{ url: 'data:x', title: 'd', pinned: false, active: false }] }]);
  assert.equal(plan.windows.length, 1);
  assert.deepEqual(plan.windows[0].tabs.map((t) => t.url), ['https://p.com', 'https://a.com']);
  assert.equal(plan.windows[0].tabs.filter((t) => t.active).length, 1);
  assert.equal(plan.skipped.length, 2);
});

test('planRestore preserves the saved active tab', () => {
  const plan = planRestore([{ tabs: [{ url: 'https://a.com', active: false }, { url: 'https://b.com', active: true }] }]);
  assert.deepEqual(plan.windows[0].tabs.map((t) => t.active), [false, true]);
});

test('fingerprint changes with content and ignores titles', () => {
  const a = [{ tabs: [{ url: 'https://a.com', title: 'A', pinned: false }] }];
  const b = [{ tabs: [{ url: 'https://a.com', title: 'Other', pinned: false }] }];
  const c = [{ tabs: [{ url: 'https://a.com', title: 'A', pinned: true }] }];
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
  assert.equal(countTabs([...a, ...c]), 2);
});

test('mergeSavedTabs dedupes by normalized URL', () => {
  const merged = mergeSavedTabs([{ url: 'https://a.com/x' }], [{ url: 'https://a.com/x#y' }, { url: 'https://b.com/' }]);
  assert.deepEqual(merged.map((t) => t.url), ['https://a.com/x', 'https://b.com/']);
});
