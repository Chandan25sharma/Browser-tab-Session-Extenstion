import { db, STORES } from '../storage/db.js';
import { getSettings, updateSettings, removeLocal } from '../storage/settings.js';
import { BACKUP_FORMAT, BACKUP_VERSION, DEFAULT_SETTINGS } from '../core/validation.js';
import { serializeWindows, countTabs } from '../core/sessions.js';
import * as tabs from './tabs.js';
import * as ws from './workspaces.js';
import * as recovery from './recovery.js';
import { restoreWindows } from './restore.js';
import { notify, ownPagePrefixes, uid } from './util.js';
import { ensureAlarms } from './alarms.js';

async function saveSession({ name, scope, windowId, tabIds }) {
  const groups = await chrome.tabGroups.query({});
  let windows;
  if (scope === 'window') {
    windows = [await chrome.windows.get(windowId, { populate: true })];
  } else if (scope === 'all') {
    windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  } else {
    const picked = (await Promise.allSettled(tabIds.map((id) => chrome.tabs.get(id)))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const byWindow = new Map();
    for (const t of picked) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, { type: 'normal', tabs: [] });
      byWindow.get(t.windowId).tabs.push(t);
    }
    windows = [...byWindow.values()];
  }
  const saved = serializeWindows(windows, groups, { skipPrefixes: ownPagePrefixes() });
  if (!countTabs(saved)) throw new Error('Nothing to save: there are no saveable tabs here');
  const now = Date.now();
  const session = { id: uid('session'), name, createdAt: now, updatedAt: now, windows: saved };
  await db.put('sessions', session); // persisted before we acknowledge
  notify('sessions');
  return session;
}

async function renameSession({ id, name }) {
  const s = await db.get('sessions', id);
  if (!s) throw new Error('Session not found');
  Object.assign(s, { name, updatedAt: Date.now() });
  await db.put('sessions', s);
  notify('sessions');
  return s;
}

async function exportBackup() {
  const [workspaces, sessions, tabMetadata, settings] = await Promise.all([
    db.getAll('workspaces'), db.getAll('sessions'), db.getAll('tabMetadata'), getSettings(),
  ]);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), workspaces, sessions, tabMetadata, settings };
}

async function importBackup({ data, mode }) {
  if (mode === 'replace') {
    await db.replace({ workspaces: data.workspaces, sessions: data.sessions, tabMetadata: data.tabMetadata });
  } else {
    // Merge: same id overwrites; a workspace whose name clashes with a different existing one is renamed.
    const existing = await db.getAll('workspaces');
    for (const w of data.workspaces) {
      const clash = existing.find((e) => e.id !== w.id && e.name.toLowerCase() === w.name.toLowerCase());
      if (clash) w.name = `${w.name} (imported)`.slice(0, 60);
    }
    await db.putMany('workspaces', data.workspaces);
    await db.putMany('sessions', data.sessions);
    await db.putMany('tabMetadata', data.tabMetadata);
  }
  if (Object.keys(data.settings).length) await updateSettings(data.settings);
  await ensureAlarms();
  notify('workspaces', 'sessions', 'tabs', 'settings');
  return { workspaces: data.workspaces.length, sessions: data.sessions.length };
}

async function resetAll() {
  await db.replace(Object.fromEntries(STORES.map((s) => [s, []])));
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  await removeLocal('pendingRecovery');
  await chrome.action.setBadgeText({ text: '' });
  await ensureAlarms();
  notify('workspaces', 'sessions', 'tabs', 'settings', 'recovery');
  return {};
}

export async function openDashboard(view = '') {
  const base = chrome.runtime.getURL('dashboard.html');
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  const url = view ? `${base}#${view}` : base;
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, ...(view ? { url } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return {};
}

export const handlers = {
  'state.get': () => tabs.getState(),
  'tabs.activate': (m) => tabs.activateTab(m.tabId),
  'tabs.close': (m) => tabs.closeTabs(m.tabIds, m.force),
  'tabs.pin': (m) => tabs.pinTabs(m.tabIds, m.pinned),
  'tabs.discard': (m) => tabs.discardTabs(m.tabIds),
  'tabs.moveToNewWindow': (m) => tabs.moveToNewWindow(m.tabIds),
  'tabs.protect': (m) => tabs.setProtected(m.urls, m.protected),

  'sessions.list': async () => (await db.getAll('sessions')).sort((a, b) => b.createdAt - a.createdAt),
  'sessions.save': saveSession,
  'sessions.rename': renameSession,
  'sessions.delete': async (m) => { await db.delete('sessions', m.id); notify('sessions'); return {}; },
  'restore': (m) => restoreWindows(m.windows, { newWindow: m.newWindow, windowId: m.windowId }),

  'workspaces.list': () => ws.listWorkspaces(),
  'workspaces.create': (m) => ws.createWorkspace(m),
  'workspaces.update': (m) => ws.updateWorkspace(m),
  'workspaces.reorder': (m) => ws.reorderWorkspaces(m.ids),
  'workspaces.delete': (m) => ws.deleteWorkspace(m.id),
  'workspaces.addTabs': (m) => ws.addTabs(m.id, m.tabIds),
  'workspaces.removeTab': (m) => ws.removeTabFromWorkspace(m.id, m.url),
  'workspaces.open': (m) => ws.openWorkspace(m.id, m.windowId),

  'recovery.list': () => recovery.listSnapshots(),
  'recovery.status': () => recovery.getRecoveryStatus(),
  'recovery.snapshotNow': () => recovery.takeSnapshot('manual'),
  'recovery.delete': async (m) => { await recovery.deleteSnapshot(m.id); return {}; },
  'recovery.dismiss': async () => { await recovery.dismissRecovery(); return {}; },
  'chromeSessions.list': () => recovery.listChromeRecentlyClosed(),
  'chromeSessions.restore': async (m) => { await chrome.sessions.restore(m.sessionId); return {}; },

  'settings.get': () => getSettings(),
  'settings.set': async (m) => {
    const s = await updateSettings(m.patch);
    await ensureAlarms();
    notify('settings');
    return s;
  },
  'backup.export': exportBackup,
  'backup.import': importBackup,
  'data.reset': resetAll,
  'dashboard.open': (m) => openDashboard(m.view),
};
