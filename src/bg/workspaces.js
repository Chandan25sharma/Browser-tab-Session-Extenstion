// Workspaces are persistent records owned by the extension. A workspace is linked to
// live Chrome tab groups by group title, because tab-group ids do not survive restarts.

import { db } from '../storage/db.js';
import { getSettings } from '../storage/settings.js';
import { normalizeUrl, hostnameOf } from '../core/url.js';
import { mergeSavedTabs, fingerprint } from '../core/sessions.js';
import { findWorkspaceForUrl } from '../core/rules.js';
import { restoreWindows } from './restore.js';
import { createQueue, notify, ownPagePrefixes, uid } from './util.js';

const STORE = 'workspaces';
const queue = createQueue();

export async function listWorkspaces() {
  return (await db.getAll(STORE)).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

async function getWorkspace(id) {
  const ws = await db.get(STORE, id);
  if (!ws) throw new Error('Workspace not found. It may have been deleted.');
  return ws;
}

async function assertUniqueName(name, exceptId) {
  const clash = (await db.getAll(STORE)).find((w) => w.id !== exceptId && w.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`A workspace named "${clash.name}" already exists`);
}

async function liveGroups(name, windowId) {
  const groups = await chrome.tabGroups.query(windowId == null ? {} : { windowId });
  return groups.filter((g) => g.title === name);
}

async function tabsInGroups(groups) {
  const lists = await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })));
  return lists.flat();
}

const toSaved = (t) => ({ url: t.url || t.pendingUrl || '', title: t.title || t.url || '', pinned: !!t.pinned });
const isOwnPage = (url) => ownPagePrefixes().some((p) => url.startsWith(p));

/** Puts tabs (all in one window, none pinned) into the workspace's group in that window. */
async function groupInto(ws, windowId, tabIds) {
  if (!tabIds.length) return;
  const [existing] = await liveGroups(ws.name, windowId);
  if (existing) {
    await chrome.tabs.group({ groupId: existing.id, tabIds });
  } else {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: ws.name, color: ws.color });
  }
}

export function createWorkspace({ name, color, icon, openInNewWindow, tabIds, rules }) {
  return queue(async () => {
    await assertUniqueName(name);
    const all = await db.getAll(STORE);
    const now = Date.now();
    const ws = {
      id: uid('ws'), name, color, icon, openInNewWindow, rules,
      order: all.reduce((m, w) => Math.max(m, w.order + 1), 0),
      createdAt: now, updatedAt: now, tabs: [],
    };
    await db.put(STORE, ws);
    notify('workspaces');
    return ws;
  }).then(async (ws) => (tabIds.length ? addTabs(ws.id, tabIds, { newWindow: openInNewWindow }) : ws));
}

/** Assigns open tabs to a workspace and groups them natively. Tabs are moved, never closed. */
export function addTabs(id, tabIds, { newWindow = false } = {}) {
  return queue(async () => {
    const ws = await getWorkspace(id);
    let tabs = (await Promise.allSettled(tabIds.map((t) => chrome.tabs.get(t)))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
    tabs = tabs.filter((t) => !isOwnPage(t.url || ''));
    if (!tabs.length) throw new Error('None of the selected tabs can be added (they may have been closed)');

    if (newWindow) {
      const win = await chrome.windows.create({ tabId: tabs[0].id, focused: true });
      const rest = tabs.slice(1).map((t) => t.id);
      if (rest.length) await chrome.tabs.move(rest, { windowId: win.id, index: -1 });
      tabs = await Promise.all(tabs.map((t) => chrome.tabs.get(t.id)));
    }

    const byWindow = new Map();
    for (const t of tabs.filter((t) => !t.pinned)) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(t.id);
    }
    for (const [windowId, ids] of byWindow) await groupInto(ws, windowId, ids);

    ws.tabs = mergeSavedTabs(ws.tabs, tabs.map(toSaved));
    ws.updatedAt = Date.now();
    await db.put(STORE, ws);
    notify('workspaces');
    return ws;
  });
}

export function updateWorkspace({ id, ...patch }) {
  return queue(async () => {
    const ws = await getWorkspace(id);
    if (patch.name !== undefined && patch.name !== ws.name) await assertUniqueName(patch.name, id);
    const groups = await liveGroups(ws.name);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) ws[k] = v;
    for (const g of groups) await chrome.tabGroups.update(g.id, { title: ws.name, color: ws.color }).catch(() => {});
    ws.updatedAt = Date.now();
    await db.put(STORE, ws);
    notify('workspaces', 'tabs');
    return ws;
  });
}

export function reorderWorkspaces(ids) {
  return queue(async () => {
    const all = await db.getAll(STORE);
    const pos = new Map(ids.map((id, i) => [id, i]));
    all.forEach((w) => { w.order = pos.has(w.id) ? pos.get(w.id) : ids.length + w.order; });
    await db.putMany(STORE, all);
    notify('workspaces');
  });
}

/** Deletes the record and ungroups its live tabs. No tab is closed and no session is touched. */
export function deleteWorkspace(id) {
  return queue(async () => {
    const ws = await getWorkspace(id);
    const tabs = await tabsInGroups(await liveGroups(ws.name));
    if (tabs.length) await chrome.tabs.ungroup(tabs.map((t) => t.id)).catch(() => {});
    await db.delete(STORE, id);
    notify('workspaces', 'tabs');
    return { ungrouped: tabs.length };
  });
}

export function removeTabFromWorkspace(id, url) {
  return queue(async () => {
    const ws = await getWorkspace(id);
    const key = normalizeUrl(url);
    ws.tabs = ws.tabs.filter((t) => normalizeUrl(t.url) !== key);
    const live = (await tabsInGroups(await liveGroups(ws.name))).filter((t) => normalizeUrl(t.url || '') === key);
    if (live.length) await chrome.tabs.ungroup(live.map((t) => t.id)).catch(() => {});
    ws.updatedAt = Date.now();
    await db.put(STORE, ws);
    notify('workspaces', 'tabs');
    return ws;
  });
}

/**
 * Switches to a workspace: focuses its live group (collapsing other workspace groups
 * in that window), or reopens its saved tabs as a group.
 */
export async function openWorkspace(id, windowId) {
  const ws = await getWorkspace(id);
  const groups = await liveGroups(ws.name);
  if (groups.length) {
    const group = groups.find((g) => g.windowId === windowId) || groups[0];
    const [first] = await chrome.tabs.query({ groupId: group.id });
    const names = new Set((await listWorkspaces()).map((w) => w.name));
    for (const g of await chrome.tabGroups.query({ windowId: group.windowId })) {
      if (g.id !== group.id && names.has(g.title)) await chrome.tabGroups.update(g.id, { collapsed: true }).catch(() => {});
    }
    await chrome.tabGroups.update(group.id, { collapsed: false });
    if (first) {
      await chrome.windows.update(group.windowId, { focused: true });
      await chrome.tabs.update(first.id, { active: true });
    }
    return { focused: true };
  }
  if (!ws.tabs.length) throw new Error('This workspace has no saved tabs yet. Select open tabs and add them to it.');
  const tabs = ws.tabs.map((t, i) => ({ ...t, active: i === 0, ...(t.pinned ? {} : { groupTitle: ws.name, groupColor: ws.color }) }));
  return restoreWindows([{ tabs }], { newWindow: ws.openInNewWindow, windowId });
}

/** Keeps each workspace's saved tabs in step with its live group(s). Runs debounced after tab events. */
export function syncFromGroups() {
  return queue(async () => {
    const all = await db.getAll(STORE);
    const changed = [];
    for (const ws of all) {
      const tabs = await tabsInGroups(await liveGroups(ws.name));
      if (!tabs.length) continue; // group closed: keep the last saved state
      tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
      const grouped = tabs.map(toSaved).filter((t) => t.url);
      const next = mergeSavedTabs(ws.tabs.filter((t) => t.pinned), grouped);
      if (fingerprint([{ tabs: next }]) !== fingerprint([{ tabs: ws.tabs }])) {
        ws.tabs = next;
        ws.updatedAt = Date.now();
        changed.push(ws);
      }
    }
    if (changed.length) {
      await db.putMany(STORE, changed);
      notify('workspaces');
    }
  });
}

// ---------- automatic grouping rules ----------

/**
 * Applies domain rules once a tab finishes loading (so redirects settle first).
 * Only ungrouped, unpinned tabs are touched, and each tab is grouped at most once
 * per hostname, so removing a tab from the group is a lasting user override.
 */
export async function applyRules(tab) {
  if (tab.pinned || tab.groupId !== -1 || tab.incognito) return;
  const settings = await getSettings();
  if (!settings.rulesEnabled) return;
  const ws = findWorkspaceForUrl(await listWorkspaces(), tab.url || '');
  if (!ws) return;
  const host = hostnameOf(tab.url);
  const { ruleApplied = {} } = await chrome.storage.session.get('ruleApplied');
  if (ruleApplied[tab.id] === host) return;
  ruleApplied[tab.id] = host;
  await chrome.storage.session.set({ ruleApplied });
  await queue(() => groupInto(ws, tab.windowId, [tab.id]));
}

export async function forgetRuleTab(tabId) {
  const { ruleApplied } = await chrome.storage.session.get('ruleApplied');
  if (ruleApplied && tabId in ruleApplied) {
    delete ruleApplied[tabId];
    await chrome.storage.session.set({ ruleApplied });
  }
}
