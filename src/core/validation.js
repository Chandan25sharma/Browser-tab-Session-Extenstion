// Validation for messages from extension pages and for imported backup files.
// Every validator returns a clean copy or throws ValidationError.

import { MAX_URL_LENGTH } from './url.js';
import { normalizeRulePattern } from './rules.js';

export class ValidationError extends Error {}

export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const WORKSPACE_ICONS = ['briefcase', 'code', 'book', 'home', 'star', 'cart', 'plane', 'chart', 'globe', 'music'];

const fail = (msg) => { throw new ValidationError(msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, name, { max = 500, min = 0, trim = true } = {}) {
  if (typeof v !== 'string') fail(`${name} must be text`);
  const s = trim ? v.trim() : v;
  if (s.length < min) fail(min === 1 ? `${name} is required` : `${name} is too short`);
  if (s.length > max) fail(`${name} is too long (max ${max} characters)`);
  return s;
}
function int(v, name, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isInteger(v) || v < min || v > max) fail(`${name} must be a whole number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}`);
  return v;
}
function bool(v, name) {
  if (typeof v !== 'boolean') fail(`${name} must be true or false`);
  return v;
}
function oneOf(v, name, options) {
  if (!options.includes(v)) fail(`${name} must be one of: ${options.join(', ')}`);
  return v;
}
function arr(v, name, { max = 10000 } = {}) {
  if (!Array.isArray(v)) fail(`${name} must be a list`);
  if (v.length > max) fail(`${name} has too many items (max ${max})`);
  return v;
}
const opt = (v, fn) => (v === undefined ? undefined : fn(v));
const tabIds = (v) => arr(v, 'tabIds', { max: 5000 }).map((id) => int(id, 'tab id', { min: 0 }));
const id = (v, name = 'id') => str(v, name, { min: 1, max: 100 });

// ---------- saved data ----------

export function validateSavedTab(t) {
  if (!isObj(t)) fail('Each tab must be an object');
  const tab = {
    url: str(t.url, 'Tab URL', { max: MAX_URL_LENGTH, min: 1 }),
    title: t.title == null ? '' : str(t.title, 'Tab title', { max: 2000 }),
    pinned: t.pinned == null ? false : bool(t.pinned, 'pinned'),
    active: t.active == null ? false : bool(t.active, 'active'),
  };
  if (t.groupTitle != null) tab.groupTitle = str(t.groupTitle, 'Group title', { max: 200 });
  if (t.groupColor != null) tab.groupColor = oneOf(t.groupColor, 'Group color', GROUP_COLORS);
  return tab;
}

export function validateSavedWindows(v) {
  return arr(v, 'windows', { max: 100 }).map((w) => {
    if (!isObj(w)) fail('Each window must be an object');
    return { tabs: arr(w.tabs, 'window tabs', { max: 5000 }).map(validateSavedTab) };
  });
}

const timestamp = (v, name) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fail(`${name} must be a timestamp`));

export function validateSession(s) {
  if (!isObj(s)) fail('Session must be an object');
  const createdAt = timestamp(s.createdAt, 'createdAt');
  return {
    id: id(s.id),
    name: str(s.name, 'Session name', { min: 1, max: 200 }),
    createdAt,
    updatedAt: s.updatedAt == null ? createdAt : timestamp(s.updatedAt, 'updatedAt'),
    windows: validateSavedWindows(s.windows),
  };
}

export function validateRules(v) {
  const out = [];
  for (const raw of arr(v, 'rules', { max: 200 })) {
    const p = normalizeRulePattern(str(raw, 'rule', { max: 300 }));
    if (!p) fail(`"${raw}" is not a valid domain (example: github.com)`);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function validateWorkspace(w) {
  if (!isObj(w)) fail('Workspace must be an object');
  const createdAt = timestamp(w.createdAt, 'createdAt');
  return {
    id: id(w.id),
    name: str(w.name, 'Workspace name', { min: 1, max: 60 }),
    color: oneOf(w.color, 'color', GROUP_COLORS),
    icon: w.icon == null ? 'briefcase' : oneOf(w.icon, 'icon', WORKSPACE_ICONS),
    order: w.order == null ? 0 : int(w.order, 'order'),
    openInNewWindow: w.openInNewWindow == null ? true : bool(w.openInNewWindow, 'openInNewWindow'),
    createdAt,
    updatedAt: w.updatedAt == null ? createdAt : timestamp(w.updatedAt, 'updatedAt'),
    tabs: arr(w.tabs ?? [], 'workspace tabs', { max: 5000 }).map(validateSavedTab),
    rules: validateRules(w.rules ?? []),
  };
}

export function validateTabMeta(m) {
  if (!isObj(m)) fail('Tab metadata must be an object');
  return { key: str(m.key, 'key', { min: 1, max: MAX_URL_LENGTH }), protected: bool(m.protected, 'protected'), updatedAt: timestamp(m.updatedAt ?? 0, 'updatedAt') };
}

// ---------- settings ----------

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  recoveryEnabled: true,
  recoveryIntervalMinutes: 5,
  recoveryRetention: 10,
  startupPrompt: true,
  inactiveMinutes: 60,
  excludePinned: true,
  excludeAudible: true,
  autoDiscardEnabled: false,
  autoDiscardMinutes: 240,
  rulesEnabled: false,
  stripTrackingParams: true,
});

const SETTING_VALIDATORS = {
  theme: (v) => oneOf(v, 'theme', ['system', 'light', 'dark']),
  recoveryEnabled: (v) => bool(v, 'recoveryEnabled'),
  recoveryIntervalMinutes: (v) => int(v, 'Snapshot interval', { min: 1, max: 60 }),
  recoveryRetention: (v) => int(v, 'Snapshots to keep', { min: 1, max: 100 }),
  startupPrompt: (v) => bool(v, 'startupPrompt'),
  inactiveMinutes: (v) => int(v, 'Inactive after', { min: 5, max: 43200 }),
  excludePinned: (v) => bool(v, 'excludePinned'),
  excludeAudible: (v) => bool(v, 'excludeAudible'),
  autoDiscardEnabled: (v) => bool(v, 'autoDiscardEnabled'),
  autoDiscardMinutes: (v) => int(v, 'Automatic cleanup after', { min: 15, max: 43200 }),
  rulesEnabled: (v) => bool(v, 'rulesEnabled'),
  stripTrackingParams: (v) => bool(v, 'stripTrackingParams'),
};

/** Validates a partial settings object; unknown keys are rejected. */
export function validateSettingsPatch(patch) {
  if (!isObj(patch)) fail('Settings must be an object');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTING_VALIDATORS[k]) fail(`Unknown setting "${k}"`);
    out[k] = SETTING_VALIDATORS[k](v);
  }
  return out;
}

/** Merges stored settings over defaults, silently dropping invalid or unknown values. */
export function sanitizeSettings(stored) {
  const out = { ...DEFAULT_SETTINGS };
  if (!isObj(stored)) return out;
  for (const [k, fn] of Object.entries(SETTING_VALIDATORS)) {
    if (stored[k] === undefined) continue;
    try { out[k] = fn(stored[k]); } catch { /* keep default */ }
  }
  return out;
}

// ---------- backup ----------

export const BACKUP_FORMAT = 'tabpilot-backup';
export const BACKUP_VERSION = 1;

export function validateBackup(data) {
  if (!isObj(data) || data.format !== BACKUP_FORMAT) fail('This file is not a TabPilot backup');
  if (data.version !== BACKUP_VERSION) fail(`Unsupported backup version: ${data.version}`);
  const withIndex = (list, name, fn) => arr(list ?? [], name).map((item, i) => {
    try { return fn(item); } catch (e) { fail(`${name} #${i + 1}: ${e.message}`); }
  });
  const workspaces = withIndex(data.workspaces, 'Workspace', validateWorkspace);
  const names = new Set();
  for (const w of workspaces) {
    const key = w.name.toLowerCase();
    if (names.has(key)) fail(`Duplicate workspace name "${w.name}"`);
    names.add(key);
  }
  return {
    workspaces,
    sessions: withIndex(data.sessions, 'Session', validateSession),
    tabMetadata: withIndex(data.tabMetadata, 'Tab metadata', validateTabMeta),
    settings: data.settings == null ? {} : sanitizeSettings(data.settings),
  };
}

// ---------- requests ----------

const restoreTarget = (m) => ({
  windows: validateSavedWindows(m.windows),
  newWindow: m.newWindow == null ? true : bool(m.newWindow, 'newWindow'),
  windowId: opt(m.windowId, (v) => int(v, 'windowId', { min: 0 })),
});

const REQUESTS = {
  'state.get': () => ({}),
  'tabs.activate': (m) => ({ tabId: int(m.tabId, 'tabId', { min: 0 }) }),
  'tabs.close': (m) => ({ tabIds: tabIds(m.tabIds), force: m.force == null ? false : bool(m.force, 'force') }),
  'tabs.pin': (m) => ({ tabIds: tabIds(m.tabIds), pinned: bool(m.pinned, 'pinned') }),
  'tabs.discard': (m) => ({ tabIds: tabIds(m.tabIds) }),
  'tabs.moveToNewWindow': (m) => ({ tabIds: tabIds(m.tabIds) }),
  'tabs.protect': (m) => ({ urls: arr(m.urls, 'urls', { max: 5000 }).map((u) => str(u, 'url', { min: 1, max: MAX_URL_LENGTH })), protected: bool(m.protected, 'protected') }),

  'sessions.list': () => ({}),
  'sessions.save': (m) => {
    const scope = oneOf(m.scope, 'scope', ['window', 'all', 'tabs']);
    return {
      name: str(m.name, 'Session name', { min: 1, max: 200 }),
      scope,
      windowId: scope === 'window' ? int(m.windowId, 'windowId', { min: 0 }) : undefined,
      tabIds: scope === 'tabs' ? tabIds(m.tabIds) : undefined,
    };
  },
  'sessions.rename': (m) => ({ id: id(m.id), name: str(m.name, 'Session name', { min: 1, max: 200 }) }),
  'sessions.delete': (m) => ({ id: id(m.id) }),
  'restore': restoreTarget,

  'workspaces.list': () => ({}),
  'workspaces.create': (m) => ({
    name: str(m.name, 'Workspace name', { min: 1, max: 60 }),
    color: oneOf(m.color, 'color', GROUP_COLORS),
    icon: oneOf(m.icon, 'icon', WORKSPACE_ICONS),
    openInNewWindow: bool(m.openInNewWindow, 'openInNewWindow'),
    tabIds: m.tabIds == null ? [] : tabIds(m.tabIds),
    rules: m.rules == null ? [] : validateRules(m.rules),
  }),
  'workspaces.update': (m) => ({
    id: id(m.id),
    name: opt(m.name, (v) => str(v, 'Workspace name', { min: 1, max: 60 })),
    color: opt(m.color, (v) => oneOf(v, 'color', GROUP_COLORS)),
    icon: opt(m.icon, (v) => oneOf(v, 'icon', WORKSPACE_ICONS)),
    openInNewWindow: opt(m.openInNewWindow, (v) => bool(v, 'openInNewWindow')),
    rules: opt(m.rules, validateRules),
  }),
  'workspaces.reorder': (m) => ({ ids: arr(m.ids, 'ids', { max: 500 }).map((v) => id(v)) }),
  'workspaces.delete': (m) => ({ id: id(m.id) }),
  'workspaces.addTabs': (m) => ({ id: id(m.id), tabIds: tabIds(m.tabIds) }),
  'workspaces.removeTab': (m) => ({ id: id(m.id), url: str(m.url, 'url', { min: 1, max: MAX_URL_LENGTH }) }),
  'workspaces.open': (m) => ({ id: id(m.id), windowId: opt(m.windowId, (v) => int(v, 'windowId', { min: 0 })) }),

  'recovery.list': () => ({}),
  'recovery.status': () => ({}),
  'recovery.snapshotNow': () => ({}),
  'recovery.delete': (m) => ({ id: id(m.id) }),
  'recovery.dismiss': () => ({}),
  'chromeSessions.list': () => ({}),
  'chromeSessions.restore': (m) => ({ sessionId: str(m.sessionId, 'sessionId', { min: 1, max: 100 }) }),

  'settings.get': () => ({}),
  'settings.set': (m) => ({ patch: validateSettingsPatch(m.patch) }),
  'backup.export': () => ({}),
  'backup.import': (m) => ({ data: validateBackup(m.data), mode: oneOf(m.mode, 'mode', ['merge', 'replace']) }),
  'data.reset': (m) => ({ confirm: oneOf(m.confirm, 'confirm', ['RESET']) }),
  'dashboard.open': (m) => ({ view: m.view == null ? '' : str(m.view, 'view', { max: 40 }) }),
};

export const REQUEST_TYPES = Object.keys(REQUESTS);

export function validateRequest(msg) {
  if (!isObj(msg) || typeof msg.type !== 'string' || !Object.hasOwn(REQUESTS, msg.type)) fail('Unknown request');
  return { type: msg.type, ...REQUESTS[msg.type](msg) };
}
