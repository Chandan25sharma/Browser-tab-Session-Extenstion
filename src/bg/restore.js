import { planRestore } from '../core/sessions.js';
import { errorMessage, windowExists } from './util.js';

/**
 * Reopens saved windows. Each saved window becomes a new Chrome window unless
 * newWindow is false, in which case the first goes into windowId.
 * Tabs are created one by one so a failure (or the user closing the window
 * mid-restore) is reported per tab instead of aborting everything.
 * @returns {{opened: number, windows: number, failed: {url, title, reason}[]}}
 */
export async function restoreWindows(saved, { newWindow = true, windowId } = {}) {
  const plan = planRestore(saved);
  const result = { opened: 0, windows: 0, failed: [...plan.skipped] };

  for (const [i, win] of plan.windows.entries()) {
    let targetId = windowId;
    let blankTabId = null;
    if (newWindow || i > 0 || targetId == null || !(await windowExists(targetId))) {
      const created = await chrome.windows.create({ focused: true });
      targetId = created.id;
      blankTabId = created.tabs?.[0]?.id ?? null;
      result.windows++;
    }

    const opened = [];
    for (let j = 0; j < win.tabs.length; j++) {
      const t = win.tabs[j];
      try {
        const tab = await chrome.tabs.create({ windowId: targetId, url: t.url, pinned: t.pinned, active: false });
        opened.push({ id: tab.id, saved: t });
        result.opened++;
      } catch (e) {
        if (!(await windowExists(targetId))) {
          for (const rest of win.tabs.slice(j)) result.failed.push({ url: rest.url, title: rest.title, reason: 'Window was closed during restore' });
          break;
        }
        result.failed.push({ url: t.url, title: t.title, reason: errorMessage(e) });
      }
    }

    await regroup(opened, targetId);

    const active = opened.find((o) => o.saved.active) || opened[0];
    if (active) await chrome.tabs.update(active.id, { active: true }).catch(() => {});
    if (blankTabId != null && opened.length) await chrome.tabs.remove(blankTabId).catch(() => {});
  }
  return result;
}

/** Recreates native tab groups from saved groupTitle/groupColor. Pinned tabs cannot be grouped. */
async function regroup(opened, windowId) {
  const groups = new Map();
  for (const o of opened) {
    if (o.saved.groupTitle == null || o.saved.pinned) continue;
    const key = `${o.saved.groupTitle}\u0000${o.saved.groupColor || ''}`;
    if (!groups.has(key)) groups.set(key, { title: o.saved.groupTitle, color: o.saved.groupColor, ids: [] });
    groups.get(key).ids.push(o.id);
  }
  for (const g of groups.values()) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: g.ids, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: g.title, ...(g.color ? { color: g.color } : {}) });
    } catch { /* tabs closed meanwhile; grouping is best-effort */ }
  }
}
