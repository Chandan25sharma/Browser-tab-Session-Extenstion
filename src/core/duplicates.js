import { normalizeUrl } from './url.js';

/**
 * Groups open tabs whose normalized URLs match. Titles are never compared.
 * @returns {{key: string, tabs: object[]}[]} groups with 2+ tabs, largest first
 */
export function findDuplicateGroups(tabs, { stripTracking = true } = {}) {
  const byKey = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url, { stripTracking });
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(tab);
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, tabs: list }))
    .sort((a, b) => b.tabs.length - a.tabs.length || a.key.localeCompare(b.key));
}

/** Tab to keep by default: active, then pinned, then protected, then most recently used. */
export function pickKeeper(tabs, isProtected = () => false) {
  const score = (t) => (t.active ? 8 : 0) + (t.pinned ? 4 : 0) + (isProtected(t) ? 2 : 0);
  return [...tabs].sort(
    (a, b) => score(b) - score(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id - b.id,
  )[0];
}

/**
 * Which tabs of a duplicate group would be closed. Pinned and protected tabs are
 * never closed; at least one tab always stays open.
 * @param keepIds tab ids the user chose to keep (defaults to the keeper)
 */
export function planDuplicateClose(group, keepIds, isProtected = () => false) {
  let keep = new Set(keepIds && keepIds.size ? keepIds : []);
  if (![...keep].some((id) => group.tabs.some((t) => t.id === id))) {
    keep = new Set([pickKeeper(group.tabs, isProtected).id]);
  }
  const close = [];
  const skipped = [];
  for (const tab of group.tabs) {
    if (keep.has(tab.id)) continue;
    if (tab.pinned || isProtected(tab)) skipped.push(tab.id);
    else close.push(tab.id);
  }
  return { close, skipped };
}
