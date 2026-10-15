import { h, icon } from './dom.js';
import { send } from './api.js';
import { openDialog, favicon, checkbox, badge, plural, toast } from './components.js';
import { restoreProblem, displayUrl } from '../core/url.js';

/**
 * Preview saved windows, pick tabs, restore, then report failures with a retry option.
 * @returns {Promise<object|null>} the last restore result, or null if cancelled
 */
export async function restoreDialog({ title, windows, currentWindowId }) {
  const selected = windows.map((w) => w.tabs.map((t) => !restoreProblem(t.url)));
  const restorableCount = selected.flat().filter(Boolean).length;
  const countEl = h('strong');
  const updateCount = () => { countEl.textContent = plural(selected.flat().filter(Boolean).length, 'tab'); };

  const windowBlocks = windows.map((w, wi) => {
    const rows = w.tabs.map((t, ti) => {
      const problem = restoreProblem(t.url);
      const box = checkbox({ checked: selected[wi][ti], disabled: !!problem, label: `Restore ${t.title || t.url}`, onChange: (v) => { selected[wi][ti] = v; updateCount(); syncHeader(); } });
      return { box, el: h('label', { class: `pick-row ${problem ? 'is-disabled' : ''}` }, box, favicon(t.url),
        h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, t.title || t.url), h('span', { class: 'pick-url' }, problem ? `Can't restore: ${problem}` : displayUrl(t.url))),
        t.pinned && badge('Pinned'), t.active && badge('Active', 'badge-accent'), t.groupTitle != null && badge(t.groupTitle || 'Group')) };
    });
    const headerBox = checkbox({ checked: true, label: `Select all tabs in window ${wi + 1}`, onChange: (v) => {
      w.tabs.forEach((t, ti) => { if (!restoreProblem(t.url)) { selected[wi][ti] = v; rows[ti].box.checked = v; } });
      updateCount();
      syncHeader();
    } });
    function syncHeader() {
      const ok = selected[wi].filter((_, ti) => !restoreProblem(w.tabs[ti].url));
      headerBox.checked = ok.length > 0 && ok.every(Boolean);
      headerBox.indeterminate = ok.some(Boolean) && !ok.every(Boolean);
    }
    syncHeader();
    return { syncHeader, el: h('section', { class: 'pick-window' }, h('label', { class: 'pick-window-head' }, headerBox, icon('window'), `Window ${wi + 1}`, h('span', { class: 'muted' }, plural(w.tabs.length, 'tab'))), rows.map((r) => r.el)) };
  });

  const newWindowRadio = h('input', { type: 'radio', name: 'restore-target', value: 'new', checked: true });
  const currentRadio = h('input', { type: 'radio', name: 'restore-target', value: 'current' });
  updateCount();

  const body = h('div', { class: 'stack' },
    h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Where to restore' },
      h('label', {}, newWindowRadio, ' Open in new window', windows.length > 1 ? 's' : ''),
      currentWindowId != null && h('label', {}, currentRadio, ' Add to this window', windows.length > 1 ? ' (other windows open separately)' : '')),
    restorableCount < selected.flat().length && h('p', { class: 'note' }, icon('info'), 'Some tabs are browser-internal or unsupported pages and will be skipped.'),
    h('div', { class: 'pick-list' }, windowBlocks.map((b) => b.el)),
    h('p', { class: 'muted' }, 'Selected: ', countEl));

  const action = await openDialog({
    title, body, wide: true,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Restore selected', value: 'restore', kind: 'btn-primary', autofocus: true }],
    validate: () => (selected.flat().some(Boolean) ? null : 'Select at least one tab to restore'),
  });
  if (!action) return null;

  const picked = windows.map((w, wi) => ({ tabs: w.tabs.filter((_, ti) => selected[wi][ti]) })).filter((w) => w.tabs.length);
  const target = currentRadio.checked && currentWindowId != null ? { newWindow: false, windowId: currentWindowId } : { newWindow: true };
  return runRestore(picked, target);
}

async function runRestore(windows, target) {
  let result;
  try {
    result = await send('restore', { windows, ...target });
  } catch (e) {
    toast(`Restore failed: ${e.message}`, 'error');
    return null;
  }
  if (!result.failed.length) {
    toast(`Restored ${plural(result.opened, 'tab')}`, 'success');
    return result;
  }
  const retryable = result.failed.filter((f) => !restoreProblem(f.url));
  const v = await openDialog({
    title: result.opened ? 'Restore partly completed' : 'Restore failed',
    body: h('div', { class: 'stack' },
      h('p', {}, `Opened ${plural(result.opened, 'tab')}. ${plural(result.failed.length, 'tab')} could not be opened:`),
      h('ul', { class: 'fail-list' }, result.failed.map((f) => h('li', {}, h('strong', {}, f.title || f.url), h('span', { class: 'muted' }, ` ${displayUrl(f.url)}`), h('div', { class: 'fail-reason' }, f.reason))))),
    actions: [{ label: 'Close', value: 'cancel' }, ...(retryable.length ? [{ label: `Retry ${plural(retryable.length, 'tab')}`, value: 'retry', kind: 'btn-primary' }] : [])],
  });
  if (v === 'retry') {
    return runRestore([{ tabs: retryable.map((f) => ({ url: f.url, title: f.title, pinned: false, active: false })) }], { newWindow: true });
  }
  return result;
}
