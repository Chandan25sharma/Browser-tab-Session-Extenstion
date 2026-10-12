import { normalizeUrl } from './url.js';

export const MERGE_WINDOW_MS = 5 * 60_000;

/**
 * Decides how a new recovery snapshot relates to the latest stored one.
 * - 'skip'   identical content
 * - 'create' new record: first snapshot, new browser session, a window closed,
 *            several tabs closed at once, or the last record is older than mergeMs
 * - 'update' small change shortly after the last record: overwrite it in place
 * Creating a record on large losses keeps the pre-loss state available for recovery.
 */
export function decideSnapshotAction(last, next, { now, sessionId, mergeMs = MERGE_WINDOW_MS }) {
  if (!last) return 'create';
  if (last.sessionId !== sessionId) return 'create';
  if (last.fingerprint === next.fingerprint) return 'skip';
  if (next.windowCount < last.windowCount) return 'create';
  if (next.tabCount <= last.tabCount - 2) return 'create';
  if (now - last.createdAt >= mergeMs) return 'create';
  return 'update';
}

/**
 * Picks the snapshot to offer after a browser restart: from the most recent previous
 * browser session, the one with the most tabs (newest wins ties).
 */
export function pickRecoveryCandidate(snapshots, currentSessionId) {
  const previous = snapshots.filter((s) => s.sessionId !== currentSessionId);
  if (!previous.length) return null;
  const lastSession = previous.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).sessionId;
  return previous
    .filter((s) => s.sessionId === lastSession)
    .reduce((a, b) => (b.tabCount > a.tabCount || (b.tabCount === a.tabCount && b.updatedAt > a.updatedAt) ? b : a));
}

/** Share (0..1) of the snapshot's URLs that are already open. */
export function coverage(snapshot, openUrls) {
  const open = new Set(openUrls.map((u) => normalizeUrl(u)));
  const urls = snapshot.windows.flatMap((w) => w.tabs.map((t) => normalizeUrl(t.url)));
  if (!urls.length) return 1;
  return urls.filter((u) => open.has(u)).length / urls.length;
}

/** Ids of snapshots to delete so at most `retention` remain; `keepId` is never deleted. */
export function snapshotsToPrune(snapshots, retention, keepId) {
  const sorted = [...snapshots].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.slice(retention).filter((s) => s.id !== keepId).map((s) => s.id);
}
