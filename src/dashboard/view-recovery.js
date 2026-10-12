import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, confirmDialog, emptyState, favicon, fmtDate, plural, relTime } from '../ui/components.js';
import { restoreDialog } from '../ui/restore-dialog.js';
import { recoveryBanner } from './view-tabs.js';

let chromeRecent = { loaded: false, items: [], error: null, loading: false };

async function loadChromeRecent(rerender) {
  chromeRecent.loading = true;
  try {
    chromeRecent = { loaded: true, items: await send('chromeSessions.list'), error: null, loading: false };
  } catch (e) {
    chromeRecent = { loaded: true, items: [], error: e.message, loading: false };
  }
  rerender();
}

export function renderRecovery(ctx) {
  const { store, ui, rerender } = ctx;
  const s = store.settings;
  if (!chromeRecent.loaded && !chromeRecent.loading) loadChromeRecent(rerender);

  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Recovery'), h('p', { class: 'muted' }, 'Automatic snapshots of your open windows, kept separate from the sessions you save.')),
      h('div', { class: 'head-actions' }, button('Take snapshot now', { iconName: 'restore', onClick: () => attempt(() => send('recovery.snapshotNow'), (r) => (r ? 'Snapshot saved' : 'Snapshots are turned off, or no tabs to save')) }))),
    recoveryBanner(ctx),
    h('div', { class: 'note' }, icon('info'), h('span', {}, `Snapshots record page addresses, pinned tabs, groups, and window layout${s ? `, every ${plural(s.recoveryIntervalMinutes, 'minute')} and after tab changes, keeping the latest ${s.recoveryRetention}` : ''}. They can't bring back form input, logins, or what was happening inside a page.${s && !s.recoveryEnabled ? ' Snapshots are currently turned off in Settings.' : ''}`)),
    h('section', { class: 'card' },
      h('header', { class: 'window-head' }, icon('lifebuoy'), h('h2', {}, 'TabPilot snapshots'), h('span', { class: 'muted' }, plural(store.snapshots.length, 'snapshot'))),
      store.snapshots.length
        ? h('div', { class: 'tab-list', role: 'list' }, store.snapshots.map((snap) => h('div', { class: 'tab-row', role: 'listitem' },
          h('button', { type: 'button', class: 'tab-main', 'data-nav': '', 'data-key': `snap-${snap.id}`, onclick: () => restoreDialog({ title: `Restore snapshot from ${fmtDate(snap.updatedAt)}`, windows: snap.windows, currentWindowId: ui.currentWindowId }) },
            h('span', { class: 'favicon favicon-generic' }, icon('window', 14)),
            h('span', { class: 'tab-text' }, h('span', { class: 'tab-title', title: fmtDate(snap.updatedAt) }, `${relTime(snap.updatedAt)} · ${plural(snap.tabCount, 'tab')} in ${plural(snap.windowCount, 'window')}`),
              h('span', { class: 'tab-url' }, `${fmtDate(snap.updatedAt)} · after: ${snap.reason}`))),
          h('span', { class: 'favicon-strip' }, snap.windows.flatMap((w) => w.tabs).slice(0, 6).map((t) => favicon(t.url))),
          h('span', { class: 'tab-actions is-visible' },
            button('Restore…', { small: true, onClick: () => restoreDialog({ title: `Restore snapshot from ${fmtDate(snap.updatedAt)}`, windows: snap.windows, currentWindowId: ui.currentWindowId }) }),
            button('', { small: true, iconName: 'trash', title: 'Delete snapshot', kind: 'btn-danger-ghost', onClick: async () => {
              if (await confirmDialog({ title: 'Delete this snapshot?', message: 'This recovery snapshot will be removed. Your saved sessions are not affected.', confirmLabel: 'Delete', danger: true })) attempt(() => send('recovery.delete', { id: snap.id }));
            } })))))
        : emptyState('lifebuoy', 'No snapshots yet', 'TabPilot saves one shortly after your tabs change.')),
    h('section', { class: 'card' },
      h('header', { class: 'window-head' }, icon('restore'), h('h2', {}, 'Recently closed in Chrome'), h('span', { class: 'spacer' }),
        button('Refresh', { small: true, kind: 'btn-ghost', onClick: () => loadChromeRecent(rerender) })),
      chromeRecent.error ? h('div', { class: 'alert alert-error' }, icon('alert'), chromeRecent.error)
        : !chromeRecent.loaded ? h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading…')
          : chromeRecent.items.length
            ? h('div', { class: 'tab-list', role: 'list' }, chromeRecent.items.map((item) => h('div', { class: 'tab-row', role: 'listitem' },
              h('div', { class: 'tab-main is-static' }, item.kind === 'window' ? h('span', { class: 'favicon favicon-generic' }, icon('window', 14)) : favicon(item.url),
                h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, item.kind === 'window' ? `Window: ${plural(item.tabCount, 'tab')}` : item.title),
                  h('span', { class: 'tab-url' }, `${item.kind === 'window' ? item.title : item.url || ''} · closed ${relTime(item.closedAt)}`))),
              h('span', { class: 'tab-actions is-visible' }, button('Reopen', { small: true, onClick: () => attempt(() => send('chromeSessions.restore', { sessionId: item.sessionId }), 'Reopened').then(() => loadChromeRecent(rerender)) })))))
            : h('p', { class: 'muted pad' }, 'Chrome has no recently closed tabs or windows for this session.')));
}
