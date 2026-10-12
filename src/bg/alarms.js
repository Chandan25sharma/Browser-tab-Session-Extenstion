import { getSettings } from '../storage/settings.js';

export const ALARMS = { snapshot: 'recovery-snapshot', cleanup: 'auto-cleanup', startup: 'startup-check' };

/** Creates or updates periodic alarms to match settings. Existing alarms with the right period are left alone. */
export async function ensureAlarms() {
  const s = await getSettings();
  await sync(ALARMS.snapshot, s.recoveryEnabled ? s.recoveryIntervalMinutes : null);
  await sync(ALARMS.cleanup, s.autoDiscardEnabled ? 5 : null);
}

async function sync(name, periodInMinutes) {
  const existing = await chrome.alarms.get(name);
  if (periodInMinutes == null) {
    if (existing) await chrome.alarms.clear(name);
  } else if (!existing || existing.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes });
  }
}
