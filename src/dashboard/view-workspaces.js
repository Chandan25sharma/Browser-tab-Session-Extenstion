import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, badge, confirmDialog, emptyState, favicon, plural, toast, GROUP_HEX } from '../ui/components.js';
import { displayUrl, normalizeUrl } from '../core/url.js';
import { workspaceEditor, addToWorkspaceFlow } from './actions.js';

export async function switchWorkspace(ws, ui) {
  const r = await attempt(() => send('workspaces.open', { id: ws.id, windowId: ui.currentWindowId ?? undefined }));
  if (!r) return;
  if (r.focused) toast(`Switched to ${ws.name}`);
  else if (r.failed?.length) toast(`Opened ${plural(r.opened, 'tab')}; ${r.failed.length} couldn't be opened`, 'error');
  else toast(`Opened ${ws.name} (${plural(r.opened, 'tab')})`, 'success');
}

function move(ctx, index, delta) {
  const ids = ctx.store.workspaces.map((w) => w.id);
  const j = index + delta;
  [ids[index], ids[j]] = [ids[j], ids[index]];
  attempt(() => send('workspaces.reorder', { ids }));
}

function workspaceCard(ws, index, ctx) {
  const { store, ui, d, rerender, liveGroupsFor } = ctx;
  const groups = liveGroupsFor(ws);
  const groupIds = new Set(groups.map((g) => g.id));
  const liveTabs = d.tabs.filter((t) => groupIds.has(t.groupId));
  const liveKeys = new Set(liveTabs.map((t) => normalizeUrl(t.url)));
  const expanded = ui.expanded.has(ws.id);
  const sel = [...ui.selection];
  const total = store.workspaces.length;

  return h('article', { class: 'card ws-card', style: `--ws:${GROUP_HEX[ws.color]}` },
    h('div', { class: 'ws-head' },
      h('span', { class: 'ws-icon' }, icon(ws.icon, 20)),
      h('div', { class: 'ws-title' }, h('h2', {}, ws.name),
        h('div', { class: 'muted' }, groups.length ? [h('span', { class: 'live-dot' }), ` Open now · ${plural(liveTabs.length, 'tab')}`] : `Not open · ${plural(ws.tabs.length, 'saved tab')}`,
          ws.openInNewWindow ? ' · opens in its own window' : ' · opens in current window')),
      h('div', { class: 'ws-actions' },
        button(groups.length ? 'Switch to' : 'Open', { kind: 'btn-primary', small: true, iconName: groups.length ? 'eye' : 'external', onClick: () => switchWorkspace(ws, ui) }),
        sel.length > 0 && button(`Add ${sel.length} selected`, { small: true, iconName: 'plus', onClick: () => attempt(() => send('workspaces.addTabs', { id: ws.id, tabIds: sel }), `Added to ${ws.name}`).then((r) => { if (r) { ui.selection.clear(); rerender(); } }) }),
        button('', { small: true, iconName: 'edit', title: 'Edit workspace', onClick: () => workspaceEditor({ ws, rulesEnabled: store.settings?.rulesEnabled }) }),
        button('', { small: true, iconName: 'up', title: 'Move up', disabled: index === 0, onClick: () => move(ctx, index, -1) }),
        button('', { small: true, iconName: 'down', title: 'Move down', disabled: index === total - 1, onClick: () => move(ctx, index, 1) }),
        button('', { small: true, iconName: 'trash', title: 'Delete workspace', kind: 'btn-danger-ghost', onClick: async () => {
          if (await confirmDialog({
            title: `Delete workspace "${ws.name}"?`,
            message: `The workspace record and its ${plural(ws.tabs.length, 'saved tab link')} are removed. Open tabs are not closed: they are just ungrouped. Saved sessions are not affected.`,
            confirmLabel: 'Delete workspace', danger: true,
          })) attempt(() => send('workspaces.delete', { id: ws.id }), `Deleted "${ws.name}"`);
        } }))),
    ws.rules.length ? h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Rules:'), ws.rules.map((r) => h('span', { class: 'chip' }, r)),
      !store.settings?.rulesEnabled && h('span', { class: 'muted' }, '(automatic grouping is off)')) : null,
    h('button', { type: 'button', class: 'linkish', 'aria-expanded': String(expanded), onclick: () => { expanded ? ui.expanded.delete(ws.id) : ui.expanded.add(ws.id); rerender(); } },
      icon(expanded ? 'up' : 'down', 14), expanded ? 'Hide saved tabs' : `Show saved tabs (${ws.tabs.length})`),
    expanded && (ws.tabs.length
      ? h('div', { class: 'tab-list', role: 'list' }, ws.tabs.map((t) => h('div', { class: 'tab-row', role: 'listitem' },
        h('div', { class: 'tab-main is-static' }, favicon(t.url), h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, t.title || t.url), h('span', { class: 'tab-url' }, displayUrl(t.url)))),
        h('span', { class: 'tab-badges' }, t.pinned && h('span', { class: 'mini', title: 'Pinned' }, icon('pin', 14)), liveKeys.has(normalizeUrl(t.url)) && badge('Open', 'badge-accent')),
        h('span', { class: 'tab-actions' }, button('', { small: true, iconName: 'x', title: 'Remove from workspace (the tab stays open)', onClick: () => attempt(() => send('workspaces.removeTab', { id: ws.id, url: t.url })) })))))
      : h('p', { class: 'muted pad' }, 'No saved tabs. Select tabs in Open tabs and choose Workspace….')));
}

export function renderWorkspaces(ctx) {
  const { store, ui } = ctx;
  const rulesOn = !!store.settings?.rulesEnabled;
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Workspaces'), h('p', { class: 'muted' }, 'Named groups of tabs for each project. Open, switch, and close them without losing their pages.')),
      h('div', { class: 'head-actions' },
        ui.selection.size > 0 && button(`Add ${ui.selection.size} selected to…`, { iconName: 'layers', onClick: () => addToWorkspaceFlow([...ui.selection], store.workspaces, rulesOn).then((r) => { if (r) ui.selection.clear(); }) }),
        button('New workspace', { kind: 'btn-primary', iconName: 'plus', onClick: () => workspaceEditor({ tabIds: [...ui.selection], rulesEnabled: rulesOn }).then((r) => { if (r) ui.selection.clear(); }) }))),
    h('div', { class: 'note' }, icon('info'), h('span', {}, 'Workspaces use Chrome tab groups to keep tabs together. They are not separate browser profiles: cookies, logins, and site data are shared across all workspaces.')),
    h('div', { class: 'card setting-inline' },
      h('div', {}, h('strong', {}, 'Automatic grouping rules'), h('div', { class: 'muted' }, 'When on, pages on a workspace\'s rule domains join its tab group after they finish loading. Tabs you ungroup are left alone. Off by default.')),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: rulesOn, 'aria-label': 'Automatic grouping rules', onchange: (e) => attempt(() => send('settings.set', { patch: { rulesEnabled: e.target.checked } }), e.target.checked ? 'Automatic grouping on' : 'Automatic grouping off') }), h('span', { class: 'switch-track' }))),
    store.workspaces.length
      ? h('div', { class: 'ws-list' }, store.workspaces.map((ws, i) => workspaceCard(ws, i, ctx)))
      : emptyState('layers', 'No workspaces yet', 'Create one for each project, e.g. Work, Development, Learning. Tip: select tabs in Open tabs first to start a workspace from them.',
        button('Create workspace', { kind: 'btn-primary', iconName: 'plus', onClick: () => workspaceEditor({ tabIds: [...ui.selection], rulesEnabled: rulesOn }) })));
}
