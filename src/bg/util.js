export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function errorMessage(e) {
  return String(e?.message || e || 'Unknown error');
}

/** Tells open extension pages that data changed. Silently ignored when no page is open. */
export function notify(...topics) {
  chrome.runtime.sendMessage({ event: 'changed', topics }).catch(() => {});
}

/** Serializes async work so overlapping event bursts cannot interleave writes. */
export function createQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}

/** URL prefixes of this extension's own pages, left out of sessions and snapshots. */
export const ownPagePrefixes = () => [chrome.runtime.getURL('')];

export async function windowExists(windowId) {
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}
