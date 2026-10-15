import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, restoreProblem, displayUrl, hostnameOf } from '../../src/core/url.js';

test('removes fragments', () => {
  assert.equal(normalizeUrl('https://example.com/a#section'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com/a#'), 'https://example.com/a');
});

test('lower-cases scheme and host but keeps path case', () => {
  assert.equal(normalizeUrl('HTTPS://GitHub.COM/Foo/Bar'), 'https://github.com/Foo/Bar');
});

test('drops default port and normalizes empty root path', () => {
  assert.equal(normalizeUrl('https://example.com:443'), 'https://example.com/');
});

test('strips only known tracking parameters, keeping order and encoding of the rest', () => {
  assert.equal(normalizeUrl('https://a.com/p?utm_source=x&q=a%20b&gclid=1&page=2'), 'https://a.com/p?q=a%20b&page=2');
  assert.equal(normalizeUrl('https://a.com/p?UTM_Medium=x'), 'https://a.com/p');
  assert.equal(normalizeUrl('https://a.com/p?id=5'), 'https://a.com/p?id=5');
});

test('keeps tracking parameters when stripping is disabled', () => {
  assert.equal(normalizeUrl('https://a.com/?utm_source=x', { stripTracking: false }), 'https://a.com/?utm_source=x');
});

test('content-changing query parameters stay distinct', () => {
  assert.notEqual(normalizeUrl('https://a.com/item?id=1'), normalizeUrl('https://a.com/item?id=2'));
});

test('http and https stay distinct', () => {
  assert.notEqual(normalizeUrl('http://a.com/'), normalizeUrl('https://a.com/'));
});

test('invalid input is returned trimmed rather than throwing', () => {
  assert.equal(normalizeUrl('  not a url '), 'not a url');
  assert.equal(normalizeUrl(undefined), '');
});

test('restoreProblem allows web and safe browser pages', () => {
  assert.equal(restoreProblem('https://example.com'), null);
  assert.equal(restoreProblem('http://localhost:3000/x'), null);
  assert.equal(restoreProblem('chrome://settings/'), null);
  assert.equal(restoreProblem('about:blank'), null);
});

test('restoreProblem rejects unsafe or unsupported URLs', () => {
  assert.match(restoreProblem('javascript:alert(1)'), /Unsupported/);
  assert.match(restoreProblem('data:text/html,hi'), /Unsupported/);
  assert.match(restoreProblem('chrome://kill'), /Unsafe/);
  assert.match(restoreProblem('chrome://crash/'), /Unsafe/);
  assert.equal(restoreProblem(''), 'Missing URL');
  assert.equal(restoreProblem('nope'), 'Invalid URL');
  assert.equal(restoreProblem(`https://a.com/${'x'.repeat(40000)}`), 'URL is too long');
});

test('display helpers', () => {
  assert.equal(displayUrl('https://github.com/'), 'github.com');
  assert.equal(displayUrl('https://github.com/a/b?x=1'), 'github.com/a/b?x=1');
  assert.equal(displayUrl('chrome://settings/'), 'chrome://settings/');
  assert.equal(hostnameOf('https://docs.github.com/x'), 'docs.github.com');
  assert.equal(hostnameOf('bad'), '');
});
