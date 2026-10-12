import { hostnameOf, isWebUrl } from './url.js';

/** Turns user input like "https://www.GitHub.com/foo" into "www.github.com". Returns null if unusable. */
export function normalizeRulePattern(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^\*\./, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+$/.test(s) || !s.includes('.') && s !== 'localhost') return null;
  return s.replace(/^\.+|\.+$/g, '') || null;
}

/** Domain rule: matches the domain itself and its subdomains. */
export function ruleMatchesHost(pattern, hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === pattern || host.endsWith(`.${pattern}`);
}

/** First workspace (in display order) with a rule matching the URL, or null. Browser-internal URLs never match. */
export function findWorkspaceForUrl(workspaces, url) {
  if (!isWebUrl(url)) return null;
  const host = hostnameOf(url);
  if (!host) return null;
  for (const ws of workspaces) {
    if ((ws.rules || []).some((p) => ruleMatchesHost(p, host))) return ws;
  }
  return null;
}
