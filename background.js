// TabPilot service worker. Listeners are registered synchronously at top level so
// Chrome can wake the worker for them; all state lives in IndexedDB/chrome.storage.

import { validateRequest, ValidationError } from './src/core/validation.js';
import { defaultSessionName } from './src/core/sessions.js';
import { handlers, openDashboard } from './src/bg/handlers.js';
import { scheduleSnapshot, takeSnapshot, startupCheck } from './src/bg/recovery.js';
import { syncFromGroups, applyRules, forgetRuleTab } from './src/bg/workspaces.js';
import { autoDiscard } from './src/bg/tabs.js';
import { ALARMS, ensureAlarms } from './src/bg/alarms.js';
import { errorMessage } from './src/bg/util.js';

const log = (label) => (e) => console.warn(`TabPilot ${label}:`, e);

// ---------- messages from extension pages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || msg.event) return false;
  (async () => {
    const req = validateRequest(msg);
    return handlers[req.type](req);
  })().then(
    (data) => sendResponse({ ok: true, data: data ?? null }),
    (e) => {
      if (!(e instanceof ValidationError)) console.warn(`TabPilot ${msg.type} failed:`, e);
      sendResponse({ ok: false, error: errorMessage(e) });
    },
  );
  return true; // async response
});

// ---------- browser events ----------

let syncTimer = null;
function onTabsChanged(reason) {
  scheduleSnapshot(reason);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncFromGroups().catch(log('workspace sync')), 800);
}

chrome.tabs.onCreated.addListener(() => onTabsChanged('tab opened'));
chrome.tabs.onRemoved.addListener((tabId, info) => {
  onTabsChanged(info.isWindowClosing ? 'window closed' : 'tab closed');
  forgetRuleTab(tabId).catch(log('rules'));
});
chrome.tabs.onMoved.addListener(() => onTabsChanged('tab moved'));
chrome.tabs.onAttached.addListener(() => onTabsChanged('tab moved'));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.pinned !== undefined || change.groupId !== undefined) onTabsChanged('tab updated');
  if (change.status === 'complete') applyRules(tab).catch(log('rules'));
});
chrome.tabGroups.onUpdated.addListener(() => onTabsChanged('group updated'));
chrome.windows.onCreated.addListener(() => onTabsChanged('window opened'));
chrome.windows.onRemoved.addListener(() => onTabsChanged('window closed'));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARMS.snapshot) takeSnapshot('scheduled').catch(log('snapshot'));
  else if (alarm.name === ALARMS.cleanup) autoDiscard().catch(log('auto cleanup'));
  else if (alarm.name === ALARMS.startup) startupCheck().catch(log('startup check'));
});

chrome.runtime.onStartup.addListener(() => {
  // Give Chrome time to reopen its own tabs before deciding whether to offer recovery.
  chrome.alarms.create(ALARMS.startup, { delayInMinutes: 0.5 });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms().catch(log('alarms'));
  takeSnapshot('installed').catch(log('snapshot'));
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') openDashboard().catch(log('command'));
  if (command === 'save-window') {
    chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      .then((win) => handlers['sessions.save']({ name: defaultSessionName(), scope: 'window', windowId: win.id }))
      .then(async () => {
        await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
        await chrome.action.setBadgeText({ text: '✓' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
      })
      .catch(log('save command'));
  }
});

// Every worker start: make sure periodic alarms exist (they survive restarts, so this is usually a no-op).
ensureAlarms().catch(log('alarms'));
