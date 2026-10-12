import { h, icon } from '../ui/dom.js';
import { send, subscribe } from '../ui/api.js';
import { applyTheme, toast, GROUP_HEX } from '../ui/components.js';
import { findDuplicateGroups } from '../core/duplicates.js';
import { normalizeUrl } from '../core/url.js';
import { renderTabs } from './view-tabs.js';
import { renderWorkspaces, switchWorkspace } from './view-workspaces.js';
import { renderSessions } from './view-sessions.js';
import { renderDuplicates } from './view-duplicates.js';
import { renderCleanup } from './view-cleanup.js';
import { renderRecovery } from './view-recovery.js';
import { renderSettings } from './view-settings.js';

const NAV = [
  { id: 'tabs', label: 'Open tabs', icon: 'tabs', render: renderTabs },
  { id: 'workspaces', label: 'Workspaces', icon: 'layers', render: renderWorkspaces },
  { id: 'sessions', label: 'Saved sessions', icon: 'bookmark', render: renderSessions },
  { id: 'duplicates', label: 'Duplicates', icon: 'copy', render: renderDuplicates },
  { id: 'cleanup', label: 'Cleanup', icon: 'zap', render: renderCleanup },
  { id: 'recovery', label: 'Recovery', icon: 'lifebuoy', render: renderRecovery },
  { id: 'settings', label: 'Settings', icon: 'sliders', render: renderSettings },
];

const store = { state: null, workspaces: [], sessions: [], snapshots: [], recovery: null, settings: null, chromeRecent: null, errors: {} };
const ui = { view: viewFromHash(), query: '', selection: new Set(), expanded: new Set(), reviewing: new Map(), cleanupSelection: new Set(), currentWindowId: null };

const LOADERS = {
  tabs: async () => {
    store.state = await send('state.get');
    const me = await chrome.tabs.getCurrent();
    ui.currentWindowId = me?.windowId ?? ui.currentWindowId;
  },
  workspaces: async () => { store.workspaces = await send('workspaces.list'); },
  sessions: async () => { store.sessions = await send('sessions.list'); },
  recovery: async () => {
    [store.snapshots, store.recovery] = await Promise.all([send('recovery.list'), send('recovery.status')]);
  },
  settings: async () => {
    store.settings = await send('settings.get');
    applyTheme(store.settings.theme);
  },
};

async function load(topics) {
  await Promise.all([...topics].filter((t) => LOADERS[t]).map(async (t) => {
    try {
      await LOADERS[t]();
      delete store.errors[t];
    } catch (e) {
      store.errors[t] = e.message;
    }
  }));
  render();
}

function viewFromHash() {
  const id = location.hash.slice(1);
  return NAV.some((n) => n.id === id) ? id : 'tabs';
}

function navigate(view) {
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  ui.view = view;
  render({ resetScroll: true });
  main.focus({ preventScroll: true });
}

// ---------- derived data ----------

function derive() {
  const tabs = store.state ? store.state.windows.flatMap((w) => w.tabs) : [];
  const protectedKeys = new Set(store.state?.protectedKeys || []);
  const isProtected = (t) => protectedKeys.has(normalizeUrl(t.url, { stripTracking: true }));
  const stripTracking = store.settings?.stripTrackingParams ?? true;
  const dupGroups = findDuplicateGroups(tabs, { stripTracking });
  const tabIds = new Set(tabs.map((t) => t.id));
  for (const id of ui.selection) if (!tabIds.has(id)) ui.selection.delete(id);
  for (const id of ui.cleanupSelection) if (!tabIds.has(id)) ui.cleanupSelection.delete(id);
  return { tabs, isProtected, dupGroups, dupExtra: dupGroups.reduce((n, g) => n + g.tabs.length - 1, 0) };
}

function liveGroupsFor(ws) {
  return (store.state?.groups || []).filter((g) => g.title === ws.name);
}

// ---------- shell ----------

const searchInput = h('input', {
  class: 'search-input', type: 'search', placeholder: 'Search tabs, websites, and saved sessions…', 'aria-label': 'Search tabs, websites, and saved sessions', autocomplete: 'off', spellcheck: 'false',
});
const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Main' });
const main = h('main', { class: 'main', tabindex: '-1' });
const themeBtn = h('button', { type: 'button', class: 'btn btn-icon', onclick: cycleTheme });

document.getElementById('app').append(
  sidebar,
  h('div', { class: 'content' },
    h('header', { class: 'topbar' },
      h('div', { class: 'search' }, icon('search'), searchInput, h('kbd', { class: 'kbd', title: 'Press / to search' }, '/')),
      themeBtn),
    main),
);

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.query = searchInput.value.trim();
    if (ui.query && ui.view !== 'tabs' && ui.view !== 'sessions') navigate('tabs');
    else render({ resetScroll: true });
  }, 120);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    main.querySelector('[data-nav]')?.focus();
  } else if (e.key === 'Escape' && searchInput.value) {
    searchInput.value = '';
    ui.query = '';
    render();
  } else if (e.key === 'Enter') {
    main.querySelector('[data-nav]')?.click();
  }
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if (e.key === '/' && !typing) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  // Arrow navigation between result rows
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement?.hasAttribute('data-nav')) {
    e.preventDefault();
    const items = [...main.querySelectorAll('[data-nav]')];
    const i = items.indexOf(document.activeElement);
    const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (e.key === 'ArrowUp') searchInput.focus();
  }
});

window.addEventListener('hashchange', () => { ui.view = viewFromHash(); render({ resetScroll: true }); });

async function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(store.settings?.theme || 'system') + 1) % order.length];
  applyTheme(next);
  try {
    store.settings = await send('settings.set', { patch: { theme: next } });
    toast(`Theme: ${next === 'system' ? 'match system' : next}`);
  } catch (e) {
    toast(e.message, 'error');
  }
  render();
}

function renderSidebar(d) {
  const counts = {
    tabs: d.tabs.length,
    workspaces: store.workspaces.length,
    sessions: store.sessions.length,
    duplicates: d.dupExtra,
    recovery: store.recovery ? '!' : null,
  };
  const wsItems = store.workspaces.map((ws) => {
    const live = liveGroupsFor(ws).length > 0;
    return h('li', {}, h('button', { type: 'button', class: 'side-ws', title: live ? `Switch to ${ws.name}` : `Open ${ws.name}`, onclick: () => switchWorkspace(ws, ui) },
      h('span', { class: 'dot', style: `background:${GROUP_HEX[ws.color]}` }), h('span', { class: 'side-ws-name' }, ws.name), live && h('span', { class: 'live-dot', title: 'Open now' })));
  });
  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon48.png', alt: '', width: 28, height: 28 }), h('div', {}, h('div', { class: 'brand-name' }, 'TabPilot'), h('div', { class: 'brand-sub' }, h('span', { class: 'live-dot' }), 'Local mode'))),
    h('ul', { class: 'nav' }, NAV.map((n) => h('li', {}, h('button', {
      type: 'button', class: `nav-item ${ui.view === n.id ? 'is-current' : ''}`, 'aria-current': ui.view === n.id ? 'page' : null, onclick: () => navigate(n.id),
    }, icon(n.icon), h('span', {}, n.label), counts[n.id] ? h('span', { class: `nav-count ${n.id === 'duplicates' || n.id === 'recovery' ? 'is-warn' : ''}` }, counts[n.id]) : null)))),
    store.workspaces.length ? h('div', { class: 'side-section' }, h('div', { class: 'side-label' }, 'Workspaces'), h('ul', { class: 'side-ws-list' }, wsItems)) : null,
    h('div', { class: 'side-foot' }, 'All data stays on this device.'),
  );
}

// ---------- render ----------

let deferred = false;
function render({ resetScroll = false } = {}) {
  // Don't rebuild the view while the user is typing in one of its fields.
  const active = document.activeElement;
  if (!resetScroll && main.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.type !== 'checkbox' && active.type !== 'radio') {
    deferred = true;
    return;
  }
  deferred = false;
  const theme = store.settings?.theme || 'system';
  themeBtn.replaceChildren(icon(theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'));
  themeBtn.title = `Theme: ${theme} (click to change)`;
  themeBtn.setAttribute('aria-label', themeBtn.title);

  const d = derive();
  renderSidebar(d);
  const focusKey = main.contains(active) ? active.dataset?.key : null;
  const scroll = main.scrollTop;
  const nav = NAV.find((n) => n.id === ui.view);
  let content;
  if (!store.state && !store.errors.tabs) {
    content = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading your tabs…');
  } else {
    try {
      content = nav.render({ store, ui, d, rerender: () => render(), navigate, refresh: load, liveGroupsFor });
    } catch (e) {
      console.error(e);
      content = h('div', { class: 'alert alert-error' }, icon('alert'), `Something went wrong showing this page: ${e.message}`);
    }
  }
  const errors = Object.entries(store.errors).map(([t, msg]) => h('div', { class: 'alert alert-error' }, icon('alert'), `Couldn't load ${t}: ${msg}`, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => load([t]) }, 'Retry')));
  main.replaceChildren(...errors, content);
  main.scrollTop = resetScroll ? 0 : scroll;
  if (focusKey) main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  document.title = `${nav.label} · TabPilot`;
}

main.addEventListener('focusout', () => {
  setTimeout(() => { if (deferred && !main.contains(document.activeElement)) render(); }, 0);
});

subscribe(load);
load(new Set(Object.keys(LOADERS)));
