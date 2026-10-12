import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, badge, checkbox, confirmDialog, emptyState, favicon, plural, relTime } from '../ui/components.js';
import { pickKeeper, planDuplicateClose } from '../core/duplicates.js';
import { displayUrl } from '../core/url.js';

async function closePlanned(plans) {
  const close = plans.flatMap((p) => p.close);
  const skipped = plans.reduce((n, p) => n + p.skipped.length, 0);
  if (!close.length) {
    await confirmDialog({ title: 'Nothing to close', message: 'Every extra copy here is pinned or protected, so TabPilot keeps them open.', confirmLabel: 'OK' });
    return null;
  }
  const ok = await confirmDialog({
    title: `Close ${plural(close.length, 'duplicate tab')}?`,
    message: `One copy of each page stays open.${skipped ? ` ${plural(skipped, 'pinned or protected copy', 'pinned or protected copies')} will be skipped.` : ''}`,
    confirmLabel: 'Close duplicates', danger: true,
  });
  if (!ok) return null;
  return attempt(() => send('tabs.close', { tabIds: close, force: false }), (r) => `Closed ${plural(r.closed, 'duplicate')}`);
}

function groupCard(group, ctx) {
  const { ui, d, rerender } = ctx;
  const keeper = pickKeeper(group.tabs, d.isProtected);
  const keep = ui.reviewing.get(group.key);
  return h('article', { class: 'card' },
    h('header', { class: 'window-head' }, icon('copy'),
      h('h2', { class: 'ellipsis', title: group.key }, displayUrl(group.key)),
      badge(`${group.tabs.length} tabs`, 'badge-warn'), h('span', { class: 'spacer' }),
      keep
        ? [button('Cancel', { small: true, kind: 'btn-ghost', onClick: () => { ui.reviewing.delete(group.key); rerender(); } }),
          button('Close unchecked', { small: true, kind: 'btn-primary', onClick: async () => {
            if (await closePlanned([planDuplicateClose(group, keep, d.isProtected)])) { ui.reviewing.delete(group.key); }
          } })]
        : [button('Review', { small: true, onClick: () => { ui.reviewing.set(group.key, new Set([keeper.id])); rerender(); } }),
          button('Close duplicates', { small: true, kind: 'btn-primary', onClick: () => closePlanned([planDuplicateClose(group, null, d.isProtected)]) })]),
    keep && h('p', { class: 'muted pad' }, 'Check the tabs to keep. Unchecked copies close; pinned and protected copies always stay open.'),
    h('div', { class: 'tab-list', role: 'list' }, group.tabs.map((t) => {
      const prot = d.isProtected(t);
      return h('div', { class: 'tab-row', role: 'listitem' },
        keep && checkbox({ checked: keep.has(t.id), label: `Keep ${t.title}`, onChange: (v) => { v ? keep.add(t.id) : keep.delete(t.id); rerender(); } }),
        h('button', { type: 'button', class: 'tab-main', 'data-nav': '', 'data-key': `dup-${t.id}`, onclick: () => attempt(() => send('tabs.activate', { tabId: t.id })), title: t.url },
          favicon(t.url), h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, t.title || t.url), h('span', { class: 'tab-url' }, `${displayUrl(t.url)}${t.lastAccessed ? ` · used ${relTime(t.lastAccessed)}` : ''}`))),
        h('span', { class: 'tab-badges' },
          !keep && t.id === keeper.id && badge('Kept', 'badge-accent'),
          t.active && badge('Active'),
          t.pinned && h('span', { class: 'mini', title: 'Pinned' }, icon('pin', 14)),
          prot && h('span', { class: 'mini mini-lock', title: 'Protected' }, icon('lock', 14))));
    })));
}

export function renderDuplicates(ctx) {
  const { d } = ctx;
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Duplicate tabs'), h('p', { class: 'muted' }, 'Tabs showing the same page. Nothing is closed until you confirm.')),
      d.dupGroups.length > 0 && h('div', { class: 'head-actions' }, button(`Close all ${d.dupExtra} duplicates`, { kind: 'btn-primary', iconName: 'x', onClick: () => closePlanned(d.dupGroups.map((g) => planDuplicateClose(g, null, d.isProtected))) }))),
    h('div', { class: 'note' }, icon('info'), h('span', {}, 'Pages match when their addresses are the same, ignoring the #section part and known tracking parameters (utm_*, gclid, fbclid…). Other query parameters, http vs https, and titles are kept distinct. Tracking-parameter handling can be turned off in Settings.')),
    d.dupGroups.length
      ? d.dupGroups.map((g) => groupCard(g, ctx))
      : emptyState('check', 'No duplicate tabs', 'Every open tab shows a different page.'));
}
