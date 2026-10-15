import { sanitizeSettings } from '../core/validation.js';

// Small values live in chrome.storage.local; larger collections live in IndexedDB.
export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return sanitizeSettings(settings);
}

/** Patch must already be validated. Resolves after the write is persisted. */
export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getLocal(key, fallback = null) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? fallback;
}

export const setLocal = (key, value) => chrome.storage.local.set({ [key]: value });
export const removeLocal = (key) => chrome.storage.local.remove(key);
