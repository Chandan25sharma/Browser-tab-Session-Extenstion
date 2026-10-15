// Typed-by-convention message client. Every request is validated again in the service worker.

export async function send(type, payload = {}) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type, ...payload });
  } catch (e) {
    throw new Error(`TabPilot background service is unavailable (${e.message}). Try reloading the extension.`);
  }
  if (!res) throw new Error('No response from the TabPilot background service');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/**
 * Calls cb(topics: Set<string>) after data changes: 'tabs' for browser tab/window
 * events, or the topics broadcast by the service worker after storage writes.
 */
export function subscribe(cb, delay = 120) {
  let pending = new Set();
  let timer = null;
  const fire = (topic) => {
    pending.add(topic);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const topics = pending;
      pending = new Set();
      cb(topics);
    }, delay);
  };
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.event === 'changed' && Array.isArray(m.topics)) m.topics.forEach(fire);
  });
  const tab = () => fire('tabs');
  for (const e of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[e].addListener(tab);
  for (const e of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) chrome.tabGroups[e].addListener(tab);
  for (const e of ['onCreated', 'onRemoved', 'onFocusChanged']) chrome.windows[e].addListener(tab);
}
