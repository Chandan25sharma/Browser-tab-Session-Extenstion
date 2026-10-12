import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, badge, checkbox, emptyState, favicon, plural, relTime, GROUP_HEX } from '../ui/components.js';
import { restoreDialog } from '../ui/restore-dialog.js';
import { tabMatches, matchesQuery } from '../core/search.js';
import { displayUrl, hostnameOf } from '../core/url.js';
import { saveSessionFlow, closeTabsFlow, discardFlow, addToWorkspaceFlow } from './actions.js';

export function recoveryBanner(ctx) {
  const rec = ctx.store.recovery;
  if (!rec) return null;
  const s = rec.snapshot;
  return h('div', { class: 'banner' }, icon('lifebuoy', 20),
    h('div', { class: 'banner-text' }, h('strong', {}, 'Restore your previous browsing?'),
      h('span', {}, ` TabPilot saved ${plural(s.tabCount, 'tab')} in ${plural(s.windowCount, 'window')} ${relTime(s.updatedAt)}, and most of them aren't open now.`)),
    button('Review & restore', { kind: 'btn-primary', small: true, onClick: async () => {
      const r = await restoreDialog({ title: 'Restore previous browsing', windows: s.windows, currentWindowId: ctx.ui.currentWindowId });
      if (r?.opened) await send('recovery.dismiss').catch(() => {});
    } }),
    button('Dismiss', { small: true, onClick: () => attempt(() => send('recovery.dismiss')) }));
}

function stat(label, value, sub, onClick) {
  return h(onClick ? 'button' : 'div', { class: `stat ${onClick ? 'stat-link' : ''}`, type: onClick ? 'button' : null, onclick: onClick },
    h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub && h('div', { class: 'stat-sub' }, sub));
}

export function tabRow(tab, ctx, { groupColor } = {}) {
  const { ui, d, rerender } = ctx;
  const prot = d.isProtected(tab);
  const selected = ui.selection.has(tab.id);
  return h('div', { class: `tab-row ${tab.active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`, role: 'listitem', style: groupColor ? `--group:${groupColor}` : null },
    checkbox({ checked: selected, label: `Select ${tab.title}`, onChange: (v) => { v ? ui.selection.add(tab.id) : ui.selection.delete(tab.id); rerender(); } }),
    h('button', { type: 'button', class: 'tab-main', 'data-nav': '', 'data-key': `tab-${tab.id}`, title: `Go to tab\n${tab.url}`, onclick: () => attempt(() => send('tabs.activate', { tabId: tab.id })) },
      favicon(tab.url),
      h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, tab.title || tab.url || 'Untitled'), h('span', { class: 'tab-url' }, displayUrl(tab.url)))),
    h('span', { class: 'tab-badges' },
      tab.active && badge('Active', 'badge-accent'),
      tab.pinned && h('span', { class: 'mini', title: 'Pinned' }, icon('pin', 14)),
      prot && h('span', { class: 'mini mini-lock', title: 'Protected from bulk close, duplicate cleanup and unloading' }, icon('lock', 14)),
      tab.audible && h('span', { class: 'mini', title: 'Playing audio' }, icon('volume', 14)),
      tab.discarded && badge('Unloaded', 'badge-muted')),
    h('span', { class: 'tab-actions' },
      button('', { iconName: prot ? 'unlock' : 'lock', small: true, title: prot ? 'Remove protection' : 'Protect this page', onClick: () => attempt(() => send('tabs.protect', { urls: [tab.url], protected: !prot })) }),
      button('', { iconName: 'pin', small: true, title: tab.pinned ? 'Unpin' : 'Pin', onClick: () => attempt(() => send('tabs.pin', { tabIds: [tab.id], pinned: !tab.pinned })) }),
      button('', { iconName: 'x', small: true, title: 'Close tab', onClick: () => attempt(() => send('tabs.close', { tabIds: [tab.id], force: true })) })));
}

function bulkBar(ctx, visibleIds) {
  const { ui, store, d, rerender } = ctx;
  const ids = [...ui.selection];
  const sel = d.tabs.filter((t) => ui.selection.has(t.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ui.selection.has(id));
  const after = (p) => p.then((r) => { if (r) { ui.selection.clear(); rerender(); } });
  return h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Tab actions' },
    h('label', { class: 'check-row' }, checkbox({
      checked: allVisibleSelected, indeterminate: !allVisibleSelected && ids.length > 0, label: 'Select all shown tabs',
      onChange: (v) => { visibleIds.forEach((id) => (v ? ui.selection.add(id) : ui.selection.delete(id))); rerender(); },
    }), h('span', {}, ids.length ? `${ids.length} selected` : 'Select all')),
    ids.length ? [
      button('Workspace…', { iconName: 'layers', small: true, onClick: () => after(addToWorkspaceFlow(ids, store.workspaces, store.settings?.rulesEnabled)) }),
      button('Save', { iconName: 'bookmark', small: true, title: 'Save selected tabs as a session', onClick: () => after(saveSessionFlow('tabs', { tabIds: ids })) }),
      button(sel.every((t) => t.pinned) ? 'Unpin' : 'Pin', { iconName: 'pin', small: true, onClick: () => attempt(() => send('tabs.pin', { tabIds: ids, pinned: !sel.every((t) => t.pinned) })) }),
      button(sel.every((t) => d.isProtected(t)) ? 'Unprotect' : 'Protect', { iconName: 'lock', small: true, onClick: () => attempt(() => send('tabs.protect', { urls: sel.map((t) => t.url), protected: !sel.every((t) => d.isProtected(t)) })) }),
      button('Unload', { iconName: 'zap', small: true, onClick: () => after(discardFlow(ids)) }),
      button('New window', { iconName: 'external', small: true, title: 'Move selected tabs to a new window', onClick: () => after(attempt(() => send('tabs.moveToNewWindow', { tabIds: ids }))) }),
      button('Close', { iconName: 'x', small: true, kind: 'btn-danger-ghost', onClick: () => after(closeTabsFlow(ids)) }),
      button('Clear', { small: true, kind: 'btn-ghost', onClick: () => { ui.selection.clear(); rerender(); } }),
    ] : [
      h('span', { class: 'spacer' }),
      button('Save this window', { iconName: 'bookmark', small: true, onClick: () => saveSessionFlow('window', { windowId: ui.currentWindowId }) }),
      button('Save all windows', { iconName: 'window', small: true, onClick: () => saveSessionFlow('all') }),
    ]);
}

function windowSection(win, index, tabs, ctx) {
  const groups = new Map((ctx.store.state.groups || []).map((g) => [g.id, g]));
  const rows = [];
  let lastGroup = -1;
  for (const tab of tabs) {
    const g = tab.groupId > -1 ? groups.get(tab.groupId) : null;
    if (g && g.id !== lastGroup) {
      rows.push(h('div', { class: 'group-head', style: `--group:${GROUP_HEX[g.color]}` }, h('span', { class: 'group-chip' }, g.title || 'Unnamed group'),
        ctx.store.workspaces.some((w) => w.name === g.title) && badge('Workspace', 'badge-muted')));
    }
    lastGroup = g ? g.id : -1;
    rows.push(tabRow(tab, ctx, { groupColor: g ? GROUP_HEX[g.color] : null }));
  }
  const isCurrent = win.id === ctx.ui.currentWindowId;
  return h('section', { class: 'card window-card' },
    h('header', { class: 'window-head' }, icon('window'), h('h2', {}, `Window ${index + 1}`), isCurrent && badge('This window', 'badge-accent'), win.incognito && badge('Incognito'),
      h('span', { class: 'muted' }, plural(win.tabs.length, 'tab')), h('span', { class: 'spacer' }),
      win.type === 'normal' && !win.incognito && button('Save window', { iconName: 'bookmark', small: true, kind: 'btn-ghost', onClick: () => saveSessionFlow('window', { windowId: win.id }) })),
    h('div', { class: 'tab-list', role: 'list' }, rows));
}

function sessionMatches(ctx) {
  const q = ctx.ui.query;
  const hits = ctx.store.sessions.map((s) => {
    const tabs = s.windows.flatMap((w) => w.tabs);
    const matching = tabs.filter((t) => matchesQuery(q, [t.title, t.url]));
    return { s, tabs, matching, nameHit: matchesQuery(q, [s.name]) };
  }).filter((x) => x.nameHit || x.matching.length);
  if (!hits.length) return null;
  return h('section', { class: 'card' },
    h('header', { class: 'window-head' }, icon('bookmark'), h('h2', {}, 'Saved sessions'), h('span', { class: 'muted' }, plural(hits.length, 'match', 'matches'))),
    h('div', { class: 'tab-list' }, hits.map(({ s, tabs, matching }) => h('div', { class: 'tab-row' },
      h('button', { type: 'button', class: 'tab-main', 'data-nav': '', 'data-key': `session-${s.id}`, onclick: () => restoreDialog({ title: `Restore "${s.name}"`, windows: s.windows, currentWindowId: ctx.ui.currentWindowId }) },
        h('span', { class: 'favicon favicon-generic' }, icon('bookmark', 14)),
        h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, s.name),
          h('span', { class: 'tab-url' }, matching.length ? `${plural(matching.length, 'matching tab')}: ${matching.slice(0, 3).map((t) => t.title || hostnameOf(t.url)).join(' · ')}` : `${plural(tabs.length, 'tab')} · saved ${relTime(s.createdAt)}`))),
      button('Restore…', { small: true, onClick: () => restoreDialog({ title: `Restore "${s.name}"`, windows: s.windows, currentWindowId: ctx.ui.currentWindowId }) })))));
}

export function renderTabs(ctx) {
  const { store, ui, d, navigate } = ctx;
  const windows = store.state.windows;
  const q = ui.query;
  const filtered = windows.map((w) => ({ w, tabs: w.tabs.filter((t) => tabMatches(t, q)) }));
  const visible = filtered.flatMap((x) => x.tabs);
  const workspaceGroups = store.state.groups.filter((g) => store.workspaces.some((w) => w.name === g.title));

  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, q ? `Results for “${q}”` : 'Open tabs'),
      h('p', { class: 'muted' }, q ? `${plural(visible.length, 'open tab')} match` : 'Everything open in Chrome right now. Click a tab to jump to it.'))),
    recoveryBanner(ctx),
    !q && h('div', { class: 'stats' },
      stat('Open tabs', d.tabs.length, plural(windows.length, 'window')),
      stat('Duplicates', d.dupExtra, d.dupGroups.length ? `in ${plural(d.dupGroups.length, 'group')}` : 'none found', () => navigate('duplicates')),
      stat('Saved sessions', store.sessions.length, store.sessions[0] ? `latest ${relTime(store.sessions[0].createdAt)}` : 'none yet', () => navigate('sessions')),
      stat('Workspaces', store.workspaces.length, `${workspaceGroups.length} open now`, () => navigate('workspaces'))),
    bulkBar(ctx, visible.map((t) => t.id)),
    visible.length
      ? filtered.map((x, i) => (x.tabs.length ? windowSection(x.w, i, x.tabs, ctx) : null))
      : emptyState('search', q ? 'No open tabs match' : 'No tabs found', q ? 'Try a different word, or part of the site address.' : null),
    q && sessionMatches(ctx));
}
