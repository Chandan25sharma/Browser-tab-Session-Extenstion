import { db } from '../storage/db.js';
import { getSettings } from '../storage/settings.js';
import { normalizeUrl } from '../core/url.js';
import { cleanupSkipReason, SKIP_REASONS } from '../core/cleanup.js';
import { errorMessage, notify } from './util.js';

export const protectionKey = (url) => normalizeUrl(url, { stripTracking: true });

export async function getProtectedKeys() {
  const rows = await db.getAll('tabMetadata');
  return new Set(rows.filter((r) => r.protected).map((r) => r.key));
}

function liteTab(t) {
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    url: t.url || t.pendingUrl || '',
    title: t.title || '',
    pinned: t.pinned,
    active: t.active,
    audible: !!t.audible,
    muted: !!t.mutedInfo?.muted,
    discarded: !!t.discarded,
    autoDiscardable: t.autoDiscardable !== false,
    groupId: t.groupId ?? -1,
    lastAccessed: t.lastAccessed || 0,
    status: t.status,
  };
}

/** Live browser state for the UI. */
export async function getState() {
  const [windows, groups, protectedKeys] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup'] }),
    chrome.tabGroups.query({}),
    getProtectedKeys(),
  ]);
  return {
    windows: windows.map((w) => ({
      id: w.id,
      focused: w.focused,
      type: w.type,
      incognito: w.incognito,
      tabs: (w.tabs || []).map(liteTab),
    })),
    groups: groups.map((g) => ({ id: g.id, windowId: g.windowId, title: g.title || '', color: g.color, collapsed: g.collapsed })),
    protectedKeys: [...protectedKeys],
  };
}

async function getTabs(tabIds) {
  const results = await Promise.allSettled(tabIds.map((id) => chrome.tabs.get(id)));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

export async function activateTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => { throw new Error('That tab is no longer open'); });
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { windowId: tab.windowId };
}

/** Closes tabs. Unless forced, pinned and protected tabs are skipped. */
export async function closeTabs(tabIds, force) {
  const tabs = await getTabs(tabIds);
  const keys = force ? new Set() : await getProtectedKeys();
  const skip = (t) => !force && (t.pinned || keys.has(protectionKey(t.url || '')));
  const toClose = tabs.filter((t) => !skip(t)).map((t) => t.id);
  if (toClose.length) await chrome.tabs.remove(toClose);
  return { closed: toClose.length, skipped: tabs.length - toClose.length, missing: tabIds.length - tabs.length };
}

export async function pinTabs(tabIds, pinned) {
  let changed = 0;
  for (const tab of await getTabs(tabIds)) {
    try {
      await chrome.tabs.update(tab.id, { pinned });
      changed++;
    } catch { /* tab closed meanwhile */ }
  }
  return { changed };
}

/**
 * Discards selected tabs. Safety exclusions (active, protected, pinned and audible
 * per settings) are re-checked here; recency is not, because the user picked them.
 */
export async function discardTabs(tabIds) {
  const [tabs, keys, settings] = await Promise.all([getTabs(tabIds), getProtectedKeys(), getSettings()]);
  const opts = { inactiveMinutes: 0, excludePinned: settings.excludePinned, excludeAudible: settings.excludeAudible, isProtected: (t) => keys.has(protectionKey(t.url || '')) };
  let discarded = 0;
  const skipped = [];
  for (const tab of tabs) {
    const reason = cleanupSkipReason(tab, opts);
    if (reason) {
      skipped.push({ id: tab.id, title: tab.title, reason: SKIP_REASONS[reason] });
      continue;
    }
    try {
      const result = await chrome.tabs.discard(tab.id);
      if (result) discarded++;
      else skipped.push({ id: tab.id, title: tab.title, reason: 'Chrome declined to unload this tab' });
    } catch (e) {
      skipped.push({ id: tab.id, title: tab.title, reason: errorMessage(e) });
    }
  }
  return { discarded, skipped };
}

/** Automatic cleanup pass, only called when the user opted in. */
export async function autoDiscard() {
  const settings = await getSettings();
  if (!settings.autoDiscardEnabled) return 0;
  const [tabs, keys] = await Promise.all([chrome.tabs.query({}), getProtectedKeys()]);
  const opts = { inactiveMinutes: settings.autoDiscardMinutes, excludePinned: settings.excludePinned, excludeAudible: settings.excludeAudible, isProtected: (t) => keys.has(protectionKey(t.url || '')) };
  let n = 0;
  for (const tab of tabs) {
    if (cleanupSkipReason(tab, opts)) continue;
    try { if (await chrome.tabs.discard(tab.id)) n++; } catch { /* not discardable */ }
  }
  return n;
}

export async function moveToNewWindow(tabIds) {
  const tabs = await getTabs(tabIds);
  if (!tabs.length) throw new Error('None of the selected tabs are open anymore');
  const win = await chrome.windows.create({ tabId: tabs[0].id, focused: true });
  const rest = tabs.slice(1).map((t) => t.id);
  if (rest.length) await chrome.tabs.move(rest, { windowId: win.id, index: -1 });
  return { windowId: win.id, moved: tabs.length };
}

export async function setProtected(urls, isProtected) {
  const keys = [...new Set(urls.map(protectionKey))];
  if (isProtected) await db.putMany('tabMetadata', keys.map((key) => ({ key, protected: true, updatedAt: Date.now() })));
  else await db.deleteMany('tabMetadata', keys);
  notify('tabs');
  return { changed: keys.length };
}
