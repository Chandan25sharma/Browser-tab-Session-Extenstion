import { h, icon } from '../ui/dom.js';
import { send, subscribe } from '../ui/api.js';
import { applyTheme, attempt, button, favicon, plural, promptDialog, toast, GROUP_HEX } from '../ui/components.js';
import { tabMatches } from '../core/search.js';
import { displayUrl, normalizeUrl } from '../core/url.js';
import { findDuplicateGroups } from '../core/duplicates.js';
import { defaultSessionName } from '../core/sessions.js';

const MAX_RESULTS = 200;
let state = null;
let settings = null;
let recovery = null;
let currentWindowId = null;
let query = '';

const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Search open tabs by title or address…', 'aria-label': 'Search open tabs', autocomplete: 'off', spellcheck: 'false' });
const counts = h('div', { class: 'popup-counts', 'aria-live': 'polite' });
const banner = h('div');
const list = h('div', { class: 'popup-list', role: 'list', 'aria-label': 'Open tabs' });

const openDashboard = (view = '') => send('dashboard.open', { view }).then(() => window.close()).catch((e) => toast(e.message, 'error'));

async function saveSession(scope) {
  const name = await promptDialog({ title: scope === 'all' ? 'Save all windows' : 'Save this window', label: 'Session name', value: defaultSessionName() });
  if (!name) return;
  await attempt(() => send('sessions.save', { name, scope, windowId: currentWindowId }), (s) => `Saved "${s.name}"`);
}

document.getElementById('popup').append(
  h('header', { class: 'popup-head' },
    h('img', { src: 'icons/icon32.png', alt: '', width: 22, height: 22 }),
    h('div', { class: 'popup-brand' }, h('strong', {}, 'TabPilot'), counts),
    button('Dashboard', { iconName: 'grid', small: true, kind: 'btn-primary', title: 'Open the full dashboard', onClick: () => openDashboard() })),
  h('div', { class: 'search popup-search' }, icon('search'), input),
  banner,
  list,
  h('footer', { class: 'popup-foot' },
    button('Save window', { iconName: 'bookmark', small: true, onClick: () => saveSession('window') }),
    button('Save all', { iconName: 'window', small: true, onClick: () => saveSession('all') }),
    button('Workspaces', { iconName: 'layers', small: true, onClick: () => openDashboard('workspaces') })),
);

function row(tab, protectedKeys) {
  const prot = protectedKeys.has(normalizeUrl(tab.url, { stripTracking: true }));
  return h('div', { class: `tab-row ${tab.active ? 'is-active' : ''}`, role: 'listitem' },
    h('button', { type: 'button', class: 'tab-main', 'data-nav': '', title: tab.url, onclick: () => send('tabs.activate', { tabId: tab.id }).then(() => window.close()).catch((e) => toast(e.message, 'error')) },
      favicon(tab.url),
      h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, tab.title || tab.url || 'Untitled'), h('span', { class: 'tab-url' }, displayUrl(tab.url)))),
    h('span', { class: 'tab-badges' },
      tab.pinned && h('span', { class: 'mini', title: 'Pinned' }, icon('pin', 13)),
      prot && h('span', { class: 'mini mini-lock', title: 'Protected' }, icon('lock', 13)),
      tab.audible && h('span', { class: 'mini', title: 'Playing audio' }, icon('volume', 13)),
      tab.discarded && h('span', { class: 'badge badge-muted' }, 'Unloaded')),
    h('span', { class: 'tab-actions' }, button('', { iconName: 'x', small: true, title: 'Close tab', onClick: () => attempt(() => send('tabs.close', { tabIds: [tab.id], force: true })) })));
}

function render() {
  if (!state) return;
  const allTabs = state.windows.flatMap((w) => w.tabs);
  const here = state.windows.find((w) => w.id === currentWindowId);
  const dupExtra = findDuplicateGroups(allTabs, { stripTracking: settings?.stripTrackingParams ?? true }).reduce((n, g) => n + g.tabs.length - 1, 0);
  counts.replaceChildren(`${plural(here?.tabs.length || 0, 'tab')} here · ${allTabs.length} total`,
    ...(dupExtra ? [' · ', h('button', { type: 'button', class: 'linkish warn', onclick: () => openDashboard('duplicates') }, plural(dupExtra, 'duplicate'))] : []));

  banner.replaceChildren(recovery ? h('div', { class: 'banner banner-sm' }, icon('lifebuoy'),
    h('span', { class: 'banner-text' }, `Restore ${plural(recovery.snapshot.tabCount, 'tab')} from your last browsing session?`),
    button('Review', { small: true, kind: 'btn-primary', onClick: () => openDashboard('recovery') })) : '');

  const protectedKeys = new Set(state.protectedKeys);
  const groups = new Map(state.groups.map((g) => [g.id, g]));
  // Current window first, then the others.
  const windows = [...state.windows].sort((a, b) => (b.id === currentWindowId) - (a.id === currentWindowId));
  let shown = 0;
  const sections = [];
  windows.forEach((w, i) => {
    const tabs = w.tabs.filter((t) => tabMatches(t, query)).slice(0, Math.max(0, MAX_RESULTS - shown));
    if (!tabs.length) return;
    shown += tabs.length;
    sections.push(h('div', { class: 'popup-win' }, w.id === currentWindowId ? 'This window' : `Other window ${i}`, h('span', { class: 'muted' }, ` · ${tabs.length}`)));
    for (const t of tabs) {
      const g = t.groupId > -1 ? groups.get(t.groupId) : null;
      const el = row(t, protectedKeys);
      if (g) { el.style.setProperty('--group', GROUP_HEX[g.color]); el.title = `Group: ${g.title || 'Unnamed'}`; }
      sections.push(el);
    }
  });
  list.replaceChildren(...(sections.length ? sections : [h('div', { class: 'empty empty-sm' }, h('p', {}, query ? `No open tabs match “${query}”.` : 'No tabs.'))]));
}

let timer = null;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => { query = input.value.trim(); render(); list.scrollTop = 0; }, 100);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('[data-nav]')?.focus(); }
  if (e.key === 'Enter') list.querySelector('[data-nav]')?.click();
});
list.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key) || !document.activeElement?.hasAttribute('data-nav')) return;
  e.preventDefault();
  const items = [...list.querySelectorAll('[data-nav]')];
  const next = items[items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1)];
  (next || (e.key === 'ArrowUp' ? input : null))?.focus();
});

async function load(topics) {
  try {
    if (topics.has('tabs')) state = await send('state.get');
    if (topics.has('settings')) { settings = await send('settings.get'); applyTheme(settings.theme); }
    if (topics.has('recovery')) recovery = await send('recovery.status');
    render();
  } catch (e) {
    list.replaceChildren(h('div', { class: 'alert alert-error' }, icon('alert'), e.message));
  }
}

chrome.windows.getCurrent().then((w) => { currentWindowId = w.id; load(new Set(['tabs', 'settings', 'recovery'])); });
subscribe(load);
input.focus();
