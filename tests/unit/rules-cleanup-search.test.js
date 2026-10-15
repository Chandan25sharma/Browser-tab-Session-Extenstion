import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRulePattern, ruleMatchesHost, findWorkspaceForUrl } from '../../src/core/rules.js';
import { cleanupSkipReason } from '../../src/core/cleanup.js';
import { matchesQuery, tabMatches } from '../../src/core/search.js';

test('rule patterns normalize to bare domains', () => {
  assert.equal(normalizeRulePattern('https://www.GitHub.com/foo?x'), 'www.github.com');
  assert.equal(normalizeRulePattern('*.example.org'), 'example.org');
  assert.equal(normalizeRulePattern('localhost'), 'localhost');
  assert.equal(normalizeRulePattern('github.com:8080'), 'github.com');
  assert.equal(normalizeRulePattern('no spaces.com'), null);
  assert.equal(normalizeRulePattern('word'), null);
});

test('rules match domain and subdomains only', () => {
  assert.ok(ruleMatchesHost('github.com', 'github.com'));
  assert.ok(ruleMatchesHost('github.com', 'gist.github.com'));
  assert.ok(!ruleMatchesHost('github.com', 'notgithub.com'));
});

test('first matching workspace wins; internal pages never match', () => {
  const ws = [{ name: 'Dev', rules: ['github.com'] }, { name: 'Other', rules: ['github.com'] }];
  assert.equal(findWorkspaceForUrl(ws, 'https://github.com/x').name, 'Dev');
  assert.equal(findWorkspaceForUrl(ws, 'chrome://settings'), null);
  assert.equal(findWorkspaceForUrl(ws, 'https://example.com'), null);
});

const now = 10_000_000;
const base = { active: false, discarded: false, pinned: false, audible: false, autoDiscardable: true, status: 'complete', lastAccessed: now - 2 * 3600_000 };
const opts = { inactiveMinutes: 60, now };

test('cleanup never selects active, protected, or already-unloaded tabs', () => {
  assert.equal(cleanupSkipReason({ ...base, active: true }, opts), 'active');
  assert.equal(cleanupSkipReason({ ...base, discarded: true }, opts), 'discarded');
  assert.equal(cleanupSkipReason(base, { ...opts, isProtected: () => true }), 'protected');
});

test('active tab is never eligible, even with exclusions off and zero recency', () => {
  assert.equal(cleanupSkipReason({ ...base, active: true }, { inactiveMinutes: 0, excludePinned: false, excludeAudible: false, now }), 'active');
});

test('cleanup exclusions for pinned and audible are configurable', () => {
  assert.equal(cleanupSkipReason({ ...base, pinned: true }, opts), 'pinned');
  assert.equal(cleanupSkipReason({ ...base, pinned: true }, { ...opts, excludePinned: false }), null);
  assert.equal(cleanupSkipReason({ ...base, audible: true }, opts), 'audible');
  assert.equal(cleanupSkipReason({ ...base, audible: true }, { ...opts, excludeAudible: false }), null);
});

test('cleanup respects recency and unknown lastAccessed', () => {
  assert.equal(cleanupSkipReason(base, opts), null);
  assert.equal(cleanupSkipReason({ ...base, lastAccessed: now - 60_000 }, opts), 'recent');
  assert.equal(cleanupSkipReason({ ...base, lastAccessed: 0 }, opts), 'recent');
  assert.equal(cleanupSkipReason({ ...base, autoDiscardable: false }, opts), 'excluded');
});

test('search matches all terms across title and URL, case-insensitive', () => {
  const tab = { title: 'Invoice #42 - Billing', url: 'https://erp.example.com/finance' };
  assert.ok(tabMatches(tab, 'invoice'));
  assert.ok(tabMatches(tab, 'INVOICE erp'));
  assert.ok(tabMatches(tab, 'finance'));
  assert.ok(!tabMatches(tab, 'invoice github'));
  assert.ok(matchesQuery('', ['anything']));
});
