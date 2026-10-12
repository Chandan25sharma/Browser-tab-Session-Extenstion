import { db } from '../storage/db.js';
import { getSettings, getLocal, setLocal, removeLocal } from '../storage/settings.js';
import { serializeWindows, countTabs, fingerprint } from '../core/sessions.js';
import { decideSnapshotAction, pickRecoveryCandidate, coverage, snapshotsToPrune } from '../core/recovery.js';
import { createQueue, notify, ownPagePrefixes, uid } from './util.js';

const STORE = 'recoverySnapshots';
const DEBOUNCE_MS = 2500;
const queue = createQueue();
let timer = null;
let sessionIdPromise = null;

/**
 * Identifies the current browser session. chrome.storage.session is cleared when
 * Chrome restarts, so a missing value means a new browser session began.
 */
export function getSessionId() {
  sessionIdPromise ??= (async () => {
    const { browserSessionId } = await chrome.storage.session.get('browserSessionId');
    if (browserSessionId) return browserSessionId;
    const id = Date.now();
    await chrome.storage.session.set({ browserSessionId: id });
    return id;
  })();
  return sessionIdPromise;
}

export async function captureWindows() {
  const [windows, groups] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
  ]);
  return serializeWindows(windows, groups, { skipPrefixes: ownPagePrefixes() });
}

/** Debounced snapshot after tab/window events. The periodic alarm covers a worker that stops before the timer fires. */
export function scheduleSnapshot(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => takeSnapshot(reason).catch((e) => console.warn('TabPilot snapshot failed:', e)), DEBOUNCE_MS);
}

export function takeSnapshot(reason) {
  return queue(async () => {
    const settings = await getSettings();
    if (!settings.recoveryEnabled) return null;
    const windows = await captureWindows();
    if (!windows.length) return null;
    const [sessionId, all, pending] = await Promise.all([getSessionId(), db.getAll(STORE), getLocal('pendingRecovery')]);
    const now = Date.now();
    const last = all.reduce((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);
    const next = { fingerprint: fingerprint(windows), tabCount: countTabs(windows), windowCount: windows.length };
    let action = decideSnapshotAction(last, next, { now, sessionId });
    // Never overwrite the snapshot the user is being offered for recovery.
    if (action === 'update' && pending?.snapshotId === last.id) action = 'create';
    if (action === 'skip') return last;

    const record = action === 'update'
      ? { ...last, ...next, windows, reason, updatedAt: now }
      : { id: uid('snap'), sessionId, createdAt: now, updatedAt: now, reason, windows, ...next };
    await db.put(STORE, record);

    const prune = snapshotsToPrune([...all.filter((s) => s.id !== record.id), record], settings.recoveryRetention, pending?.snapshotId);
    if (prune.length) await db.deleteMany(STORE, prune);
    notify('recovery');
    return record;
  });
}

export async function listSnapshots() {
  return (await db.getAll(STORE)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSnapshot(id) {
  await db.delete(STORE, id);
  const pending = await getLocal('pendingRecovery');
  if (pending?.snapshotId === id) await dismissRecovery();
  notify('recovery');
}

/** Runs shortly after Chrome starts: offers recovery if the last session's tabs did not come back. */
export async function startupCheck() {
  const settings = await getSettings();
  if (!settings.startupPrompt || !settings.recoveryEnabled) return;
  const [all, sessionId, tabs] = await Promise.all([db.getAll(STORE), getSessionId(), chrome.tabs.query({})]);
  const candidate = pickRecoveryCandidate(all, sessionId);
  if (!candidate) return;
  const cov = coverage(candidate, tabs.map((t) => t.url || t.pendingUrl || ''));
  if (cov >= 0.8) return; // Chrome already reopened (almost) everything
  await setLocal('pendingRecovery', { snapshotId: candidate.id, detectedAt: Date.now(), coverage: cov });
  await chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  await chrome.action.setBadgeText({ text: '!' });
  notify('recovery');
}

export async function getRecoveryStatus() {
  const pending = await getLocal('pendingRecovery');
  if (!pending) return null;
  const snapshot = await db.get(STORE, pending.snapshotId);
  if (!snapshot) {
    await dismissRecovery();
    return null;
  }
  return { ...pending, snapshot };
}

export async function dismissRecovery() {
  await removeLocal('pendingRecovery');
  await chrome.action.setBadgeText({ text: '' });
  notify('recovery');
}

export async function listChromeRecentlyClosed() {
  const items = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  return items.map((item) => {
    if (item.tab) {
      return { sessionId: item.tab.sessionId, kind: 'tab', title: item.tab.title || item.tab.url, url: item.tab.url, tabCount: 1, closedAt: item.lastModified * 1000 };
    }
    const tabs = item.window?.tabs || [];
    return { sessionId: item.window?.sessionId, kind: 'window', title: tabs[0]?.title || 'Window', url: tabs[0]?.url, tabCount: tabs.length, closedAt: item.lastModified * 1000 };
  }).filter((i) => i.sessionId);
}
