import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, checkbox, emptyState, favicon, plural, relTime } from '../ui/components.js';
import { cleanupSkipReason, SKIP_REASONS } from '../core/cleanup.js';
import { displayUrl } from '../core/url.js';
import { discardFlow } from './actions.js';

const DURATIONS = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '1 day'], [4320, '3 days'], [10080, '1 week']];

const saveSetting = (patch) => attempt(() => send('settings.set', { patch }));

export function renderCleanup(ctx) {
  const { store, ui, d, rerender, navigate } = ctx;
  const s = store.settings;
  if (!s) return h('div', { class: 'loading' }, 'Loading settings…');
  const now = Date.now();
  const opts = { inactiveMinutes: s.inactiveMinutes, excludePinned: s.excludePinned, excludeAudible: s.excludeAudible, now, isProtected: d.isProtected };
  const candidates = [];
  const skipped = {};
  for (const t of d.tabs) {
    const reason = cleanupSkipReason(t, opts);
    if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
    else candidates.push(t);
  }
  candidates.sort((a, b) => a.lastAccessed - b.lastAccessed);
  for (const id of ui.cleanupSelection) if (!candidates.some((t) => t.id === id)) ui.cleanupSelection.delete(id);
  const sel = [...ui.cleanupSelection];
  const allSelected = candidates.length > 0 && sel.length === candidates.length;
  const durations = DURATIONS.some(([m]) => m === s.inactiveMinutes) ? DURATIONS : [...DURATIONS, [s.inactiveMinutes, `${s.inactiveMinutes} minutes`]];

  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Tab cleanup'), h('p', { class: 'muted' }, 'Unload tabs you haven\'t used in a while. They stay in the tab strip and reload when clicked.'))),
    h('div', { class: 'note' }, icon('info'), h('span', {}, 'Unloading frees the memory a page uses until you return to it. Chrome does not tell extensions how much memory each tab uses, so TabPilot shows no memory estimates. Unsaved form input on an unloaded page may be lost.')),
    h('div', { class: 'card filters' },
      h('label', { class: 'field-inline' }, h('span', {}, 'Inactive for at least'),
        h('select', { class: 'input', onchange: (e) => saveSetting({ inactiveMinutes: Number(e.target.value) }) },
          durations.map(([m, label]) => h('option', { value: m, selected: m === s.inactiveMinutes }, label)))),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: s.excludePinned, onchange: (e) => saveSetting({ excludePinned: e.target.checked }) }), 'Skip pinned tabs'),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: s.excludeAudible, onchange: (e) => saveSetting({ excludeAudible: e.target.checked }) }), 'Skip tabs playing audio'),
      h('span', { class: 'muted' }, 'Active and protected tabs are always skipped.')),
    Object.keys(skipped).length > 0 && h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Not eligible:'),
      Object.entries(skipped).map(([k, n]) => h('span', { class: 'chip' }, `${SKIP_REASONS[k]}: ${n}`))),
    h('div', { class: 'toolbar' },
      h('label', { class: 'check-row' }, checkbox({ checked: allSelected, indeterminate: sel.length > 0 && !allSelected, disabled: !candidates.length, label: 'Select all inactive tabs',
        onChange: (v) => { ui.cleanupSelection = new Set(v ? candidates.map((t) => t.id) : []); rerender(); } }), h('span', {}, sel.length ? `${sel.length} selected` : 'Select all')),
      h('span', { class: 'spacer' }),
      button(`Unload selected${sel.length ? ` (${sel.length})` : ''}`, { kind: 'btn-primary', iconName: 'zap', small: true, disabled: !sel.length, onClick: () => discardFlow(sel).then((r) => { if (r) { ui.cleanupSelection.clear(); rerender(); } }) })),
    candidates.length
      ? h('section', { class: 'card' }, h('div', { class: 'tab-list', role: 'list' }, candidates.map((t) => h('div', { class: 'tab-row', role: 'listitem' },
        checkbox({ checked: ui.cleanupSelection.has(t.id), label: `Select ${t.title}`, onChange: (v) => { v ? ui.cleanupSelection.add(t.id) : ui.cleanupSelection.delete(t.id); rerender(); } }),
        h('button', { type: 'button', class: 'tab-main', 'data-nav': '', 'data-key': `clean-${t.id}`, onclick: () => attempt(() => send('tabs.activate', { tabId: t.id })), title: t.url },
          favicon(t.url), h('span', { class: 'tab-text' }, h('span', { class: 'tab-title' }, t.title || t.url), h('span', { class: 'tab-url' }, displayUrl(t.url)))),
        h('span', { class: 'muted nowrap' }, `used ${relTime(t.lastAccessed)}`)))))
      : emptyState('check', 'No inactive tabs to unload', `No tab matches: inactive for ${DURATIONS.find(([m]) => m === s.inactiveMinutes)?.[1] || `${s.inactiveMinutes} minutes`} and not excluded.`),
    h('p', { class: 'muted' }, 'Automatic cleanup is ', h('strong', {}, s.autoDiscardEnabled ? `on (after ${plural(s.autoDiscardMinutes, 'minute')})` : 'off'), '. ',
      h('button', { type: 'button', class: 'linkish', onclick: () => navigate('settings') }, 'Change in Settings')));
}
