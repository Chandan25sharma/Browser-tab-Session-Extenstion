import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateBackup, sanitizeSettings, validateSettingsPatch, ValidationError, DEFAULT_SETTINGS, REQUEST_TYPES } from '../../src/core/validation.js';
import { readFileSync } from 'node:fs';

test('rejects unknown and malformed requests', () => {
  assert.throws(() => validateRequest({ type: 'nope' }), ValidationError);
  assert.throws(() => validateRequest(null), ValidationError);
  assert.throws(() => validateRequest({ type: 'tabs.activate', tabId: 'x' }), ValidationError);
  assert.throws(() => validateRequest({ type: 'tabs.close', tabIds: [1, -2] }), ValidationError);
  assert.throws(() => validateRequest({ type: 'sessions.save', name: '  ', scope: 'all' }), /required/);
  assert.throws(() => validateRequest({ type: 'sessions.save', name: 'x', scope: 'window' }), /windowId/);
  assert.throws(() => validateRequest({ type: 'data.reset', confirm: 'yes' }), ValidationError);
});

test('accepts valid requests and returns clean copies', () => {
  assert.deepEqual(validateRequest({ type: 'tabs.close', tabIds: [1, 2], extra: 'dropped' }), { type: 'tabs.close', tabIds: [1, 2], force: false });
  const s = validateRequest({ type: 'sessions.save', name: ' Work ', scope: 'window', windowId: 3 });
  assert.equal(s.name, 'Work');
  const ws = validateRequest({ type: 'workspaces.create', name: 'Dev', color: 'blue', icon: 'code', openInNewWindow: false, rules: ['https://GitHub.com/x', 'github.com'] });
  assert.deepEqual(ws.rules, ['github.com']);
});

test('rejects invalid workspace colors and rules', () => {
  assert.throws(() => validateRequest({ type: 'workspaces.create', name: 'Dev', color: '#fff', icon: 'code', openInNewWindow: true }), /color/);
  assert.throws(() => validateRequest({ type: 'workspaces.update', id: 'w', rules: ['not a domain!'] }), /valid domain/);
});

test('restore validates saved windows', () => {
  assert.throws(() => validateRequest({ type: 'restore', windows: [{ tabs: [{ url: 5 }] }] }), ValidationError);
  const r = validateRequest({ type: 'restore', windows: [{ tabs: [{ url: 'https://a.com' }] }] });
  assert.deepEqual(r.windows[0].tabs[0], { url: 'https://a.com', title: '', pinned: false, active: false });
  assert.equal(r.newWindow, true);
});

test('every validated request type has a service-worker handler', () => {
  const src = readFileSync(new URL('../../src/bg/handlers.js', import.meta.url), 'utf8');
  for (const type of REQUEST_TYPES) assert.ok(src.includes(`'${type}':`), `missing handler for ${type}`);
});

test('settings sanitize falls back to defaults for bad values', () => {
  assert.deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS });
  const s = sanitizeSettings({ theme: 'neon', inactiveMinutes: 30, recoveryRetention: -1, bogus: 1 });
  assert.equal(s.theme, 'system');
  assert.equal(s.inactiveMinutes, 30);
  assert.equal(s.recoveryRetention, DEFAULT_SETTINGS.recoveryRetention);
  assert.equal('bogus' in s, false);
  assert.equal(DEFAULT_SETTINGS.autoDiscardEnabled, false, 'automatic cleanup must be opt-in');
  assert.equal(DEFAULT_SETTINGS.rulesEnabled, false, 'automatic grouping must be opt-in');
});

test('settings patch rejects unknown keys and out-of-range values', () => {
  assert.throws(() => validateSettingsPatch({ nope: true }), /Unknown setting/);
  assert.throws(() => validateSettingsPatch({ recoveryRetention: 0 }), ValidationError);
  assert.deepEqual(validateSettingsPatch({ theme: 'dark' }), { theme: 'dark' });
});

const backup = (extra = {}) => ({ format: 'tabpilot-backup', version: 1, workspaces: [], sessions: [], tabMetadata: [], settings: {}, ...extra });

test('backup validation', () => {
  assert.throws(() => validateBackup({}), /not a TabPilot backup/);
  assert.throws(() => validateBackup(backup({ version: 99 })), /Unsupported backup version/);
  assert.throws(() => validateBackup(backup({ sessions: [{ id: 's', name: 'x', createdAt: 1, windows: [{ tabs: [{ url: null }] }] }] })), /Session #1/);
  assert.throws(() => validateBackup(backup({ workspaces: [
    { id: 'a', name: 'Dev', color: 'blue', createdAt: 1 }, { id: 'b', name: 'dev', color: 'red', createdAt: 1 },
  ] })), /Duplicate workspace name/);
  const ok = validateBackup(backup({
    sessions: [{ id: 's1', name: 'Mine', createdAt: 5, windows: [{ tabs: [{ url: 'https://a.com', title: 'A', pinned: true }] }] }],
    workspaces: [{ id: 'w1', name: 'Dev', color: 'blue', createdAt: 1, rules: ['github.com'] }],
    settings: { theme: 'dark', junk: 1 },
  }));
  assert.equal(ok.sessions[0].updatedAt, 5);
  assert.equal(ok.workspaces[0].icon, 'briefcase');
  assert.equal(ok.settings.theme, 'dark');
});
