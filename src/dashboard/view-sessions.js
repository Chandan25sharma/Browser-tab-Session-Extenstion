import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, confirmDialog, emptyState, favicon, fmtDate, plural, promptDialog, relTime } from '../ui/components.js';
import { restoreDialog } from '../ui/restore-dialog.js';
import { matchesQuery } from '../core/search.js';
import { saveSessionFlow } from './actions.js';

function sessionCard(s, ctx) {
  const tabs = s.windows.flatMap((w) => w.tabs);
  return h('article', { class: 'card session-card' },
    h('div', { class: 'session-top' },
      h('h2', { class: 'session-name' }, s.name),
      h('div', { class: 'muted', title: fmtDate(s.createdAt) }, `Saved ${relTime(s.createdAt)}`)),
    h('div', { class: 'session-meta' }, h('span', {}, icon('tabs', 14), plural(tabs.length, 'tab')), h('span', {}, icon('window', 14), plural(s.windows.length, 'window')),
      tabs.some((t) => t.pinned) && h('span', {}, icon('pin', 14), `${tabs.filter((t) => t.pinned).length} pinned`)),
    h('div', { class: 'favicon-strip', 'aria-hidden': 'true' }, tabs.slice(0, 10).map((t) => favicon(t.url)), tabs.length > 10 && h('span', { class: 'muted' }, `+${tabs.length - 10}`)),
    h('div', { class: 'session-actions' },
      button('Preview & restore', { kind: 'btn-primary', small: true, iconName: 'restore', onClick: () => restoreDialog({ title: `Restore "${s.name}"`, windows: s.windows, currentWindowId: ctx.ui.currentWindowId }) }),
      button('', { small: true, iconName: 'edit', title: 'Rename', onClick: async () => {
        const name = await promptDialog({ title: 'Rename session', label: 'Session name', value: s.name });
        if (name && name !== s.name) attempt(() => send('sessions.rename', { id: s.id, name }), 'Session renamed');
      } }),
      button('', { small: true, iconName: 'trash', title: 'Delete', kind: 'btn-danger-ghost', onClick: async () => {
        if (await confirmDialog({ title: `Delete "${s.name}"?`, message: `This saved session (${plural(tabs.length, 'tab')}) will be permanently removed. Open tabs are not affected.`, confirmLabel: 'Delete session', danger: true })) {
          attempt(() => send('sessions.delete', { id: s.id }), 'Session deleted');
        }
      } })));
}

export function renderSessions(ctx) {
  const { store, ui } = ctx;
  const q = ui.query;
  const list = store.sessions.filter((s) => matchesQuery(q, [s.name, ...s.windows.flatMap((w) => w.tabs.flatMap((t) => [t.title, t.url]))]));
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Saved sessions'), h('p', { class: 'muted' }, q ? `${plural(list.length, 'session')} match “${q}”` : 'Sessions you saved yourself. They stay until you delete them, separate from automatic recovery snapshots.')),
      h('div', { class: 'head-actions' },
        button('Save this window', { iconName: 'bookmark', onClick: () => saveSessionFlow('window', { windowId: ui.currentWindowId }) }),
        button('Save all windows', { kind: 'btn-primary', iconName: 'window', onClick: () => saveSessionFlow('all') }))),
    list.length
      ? h('div', { class: 'session-grid' }, list.map((s) => sessionCard(s, ctx)))
      : emptyState('bookmark', q ? 'No sessions match' : 'No saved sessions yet', q ? null : 'Save a window before you close it, and reopen the same pages any time later.',
        !q && button('Save all windows', { kind: 'btn-primary', iconName: 'window', onClick: () => saveSessionFlow('all') })));
}
