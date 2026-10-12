// URL helpers shared by the service worker, UI and tests. Pure functions only.

// Query parameters that are known to be pure tracking and safe to ignore when
// comparing pages. Everything else is preserved because it may change content.
export const TRACKING_PARAMS = new Set([
  'gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'yclid', 'twclid', 'li_fat_id', '_hsenc', '_hsmkt', 'mkt_tok',
]);

export function isTrackingParam(key) {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_PARAMS.has(k);
}

function decodeKey(rawKey) {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
}

/**
 * Conservative URL normalization for duplicate detection and protection keys.
 * - scheme and host are lower-cased by the URL parser, default ports dropped
 * - the fragment (#...) is removed
 * - known tracking parameters are removed; other parameters keep their order and encoding
 * - http and https stay distinct; path case is preserved
 */
export function normalizeUrl(raw, { stripTracking = true } = {}) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  u.hash = '';
  if (stripTracking && u.search.length > 1) {
    const kept = u.search
      .slice(1)
      .split('&')
      .filter((pair) => pair && !isTrackingParam(decodeKey(pair.split('=')[0])));
    u.search = kept.length ? `?${kept.join('&')}` : '';
  }
  return u.href;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Short label for display: host + path for web pages, the raw URL otherwise. */
export function displayUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const path = u.pathname === '/' ? '' : u.pathname;
      return `${u.hostname}${path}${u.search}`;
    }
  } catch {
    // fall through
  }
  return url || '';
}

export function isWebUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

// chrome:// pages that crash or hang the browser when opened.
const UNSAFE_CHROME_HOSTS = new Set([
  'kill', 'crash', 'hang', 'shorthang', 'quit', 'restart', 'gpuclean', 'gpucrash',
  'gpuhang', 'memory-exhaust', 'inducebrowsercrashforrealz', 'badcastcrash',
  'crashdump', 'webuijserror',
]);

export const MAX_URL_LENGTH = 32768;

/**
 * Returns null when the URL may be reopened by the extension, otherwise a
 * human-readable reason it will be skipped.
 */
export function restoreProblem(url) {
  if (typeof url !== 'string' || !url.trim()) return 'Missing URL';
  if (url.length > MAX_URL_LENGTH) return 'URL is too long';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'Invalid URL';
  }
  switch (u.protocol) {
    case 'http:':
    case 'https:':
    case 'file:': // works only when "Allow access to file URLs" is on; failures are reported
    case 'chrome-extension:':
      return null;
    case 'chrome:':
      return UNSAFE_CHROME_HOSTS.has(u.hostname) ? 'Unsafe browser-internal page' : null;
    case 'about:':
      return url === 'about:blank' ? null : 'Unsupported about: page';
    default:
      return `Unsupported URL type (${u.protocol})`;
  }
}
