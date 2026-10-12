import { normalizeUrl, restoreProblem } from './url.js';

/**
 * Converts populated chrome.windows.Window objects into serializable saved windows.
 * Only normal, non-incognito windows are kept. Tabs whose URL starts with any of
 * skipPrefixes (the extension's own pages) are left out. Empty windows are dropped.
 */
export function serializeWindows(windows, groups = [], { skipPrefixes = [] } = {}) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const out = [];
  for (const win of windows) {
    if ((win.type && win.type !== 'normal') || win.incognito) continue;
    const tabs = [];
    for (const tab of [...(win.tabs || [])].sort((a, b) => a.index - b.index)) {
      const url = tab.url || tab.pendingUrl || '';
      if (!url || skipPrefixes.some((p) => url.startsWith(p))) continue;
      const saved = { url, title: tab.title || url, pinned: !!tab.pinned, active: !!tab.active };
      const group = tab.groupId > -1 ? groupById.get(tab.groupId) : null;
      if (group) {
        saved.groupTitle = group.title || '';
        saved.groupColor = group.color;
      }
      tabs.push(saved);
    }
    if (tabs.length) out.push({ tabs });
  }
  return out;
}

export function countTabs(windows) {
  return windows.reduce((n, w) => n + w.tabs.length, 0);
}

/** Cheap content fingerprint (FNV-1a) used to skip identical recovery snapshots. */
export function fingerprint(windows) {
  const text = windows
    .map((w) => w.tabs.map((t) => `${t.pinned ? 'P' : ''}${t.groupTitle ?? ''}|${t.url}`).join('\n'))
    .join('\n--\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

/**
 * Validates URLs and orders tabs for restoration. Pinned tabs come first (Chrome
 * requires it) and exactly one tab per window is marked active.
 */
export function planRestore(windows) {
  const skipped = [];
  const planned = [];
  for (const win of windows) {
    const ok = [];
    for (const tab of win.tabs) {
      const problem = restoreProblem(tab.url);
      if (problem) skipped.push({ url: tab.url, title: tab.title, reason: problem });
      else ok.push({ ...tab });
    }
    if (!ok.length) continue;
    const tabs = [...ok.filter((t) => t.pinned), ...ok.filter((t) => !t.pinned)];
    const activeIndex = Math.max(0, tabs.findIndex((t) => t.active));
    tabs.forEach((t, i) => { t.active = i === activeIndex; });
    planned.push({ tabs });
  }
  return { windows: planned, skipped };
}

/** Merges saved tabs, dropping later entries whose normalized URL is already present. */
export function mergeSavedTabs(existing, incoming) {
  const seen = new Set(existing.map((t) => normalizeUrl(t.url)));
  const out = [...existing];
  for (const t of incoming) {
    const key = normalizeUrl(t.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function defaultSessionName(date = new Date()) {
  return `Session ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
