// User flows shared by several dashboard views.

import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, confirmDialog, promptDialog, openDialog, plural, GROUP_HEX, toast } from '../ui/components.js';
import { defaultSessionName } from '../core/sessions.js';
import { GROUP_COLORS, WORKSPACE_ICONS } from '../core/validation.js';
import { normalizeRulePattern } from '../core/rules.js';

export async function saveSessionFlow(scope, { windowId, tabIds } = {}) {
  const what = scope === 'all' ? 'all windows' : scope === 'window' ? 'this window' : plural(tabIds.length, 'selected tab');
  const name = await promptDialog({ title: `Save ${what}`, label: 'Session name', value: defaultSessionName() });
  if (!name) return null;
  return attempt(() => send('sessions.save', { name, scope, windowId, tabIds }), (s) => `Saved "${s.name}" (${plural(s.windows.reduce((n, w) => n + w.tabs.length, 0), 'tab')})`);
}

export async function closeTabsFlow(tabIds, { force = false } = {}) {
  if (tabIds.length > 1 && !(await confirmDialog({
    title: `Close ${plural(tabIds.length, 'tab')}?`,
    message: 'Pinned and protected tabs among them will be kept open.',
    confirmLabel: 'Close tabs', danger: true,
  }))) return null;
  return attempt(() => send('tabs.close', { tabIds, force }), (r) => `Closed ${plural(r.closed, 'tab')}${r.skipped ? ` · kept ${r.skipped} pinned/protected` : ''}`);
}

export async function discardFlow(tabIds) {
  if (!(await confirmDialog({
    title: `Unload ${plural(tabIds.length, 'tab')}?`,
    message: 'Unloaded tabs stay in the tab strip and reload when you open them. Unsaved form input on those pages may be lost. Active, protected, and (per your settings) pinned or audible tabs are skipped.',
    confirmLabel: 'Unload tabs',
  }))) return null;
  const r = await attempt(() => send('tabs.discard', { tabIds }));
  if (r) toast(`Unloaded ${plural(r.discarded, 'tab')}${r.skipped.length ? ` · skipped ${r.skipped.length}` : ''}`, r.discarded ? 'success' : 'info');
  return r;
}

/** Create or edit a workspace. Returns the saved workspace or null. */
export async function workspaceEditor({ ws = null, tabIds = [], rulesEnabled = false } = {}) {
  const name = h('input', { class: 'input', value: ws?.name || '', maxlength: 60, required: true, autofocus: true, placeholder: 'e.g. Development' });
  let color = ws?.color || 'purple';
  let iconName = ws?.icon || 'briefcase';
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' }, GROUP_COLORS.map((c) => h('label', { class: 'swatch', title: c },
    h('input', { type: 'radio', name: 'ws-color', value: c, checked: c === color, onchange: () => { color = c; }, 'aria-label': c }),
    h('span', { style: `background:${GROUP_HEX[c]}` }))));
  const icons = h('div', { class: 'icon-picks', role: 'radiogroup', 'aria-label': 'Icon' }, WORKSPACE_ICONS.map((i) => h('label', { class: 'icon-pick', title: i },
    h('input', { type: 'radio', name: 'ws-icon', value: i, checked: i === iconName, onchange: () => { iconName = i; }, 'aria-label': i }), icon(i, 18))));
  const newWindow = h('input', { type: 'checkbox', checked: ws ? ws.openInNewWindow : true });
  const rules = h('textarea', { class: 'input', rows: 3, placeholder: 'github.com\ndocs.example.com' });
  rules.value = (ws?.rules || []).join('\n');

  const parseRules = () => rules.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const v = await openDialog({
    title: ws ? `Edit ${ws.name}` : 'New workspace',
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'field' }, h('span', {}, 'Color (also used for the Chrome tab group)'), swatches),
      h('div', { class: 'field' }, h('span', {}, 'Icon'), icons),
      h('label', { class: 'check-row' }, newWindow, h('span', {}, 'Open this workspace in its own window', tabIds.length ? ' (selected tabs move there now)' : '')),
      h('label', { class: 'field' }, h('span', {}, 'Automatic grouping rules: one domain per line (optional)'), rules,
        h('small', { class: 'muted' }, rulesEnabled ? 'New pages on these domains (and their subdomains) join this workspace\'s tab group.' : 'Rules are off. Turn on automatic grouping in Workspaces or Settings for them to apply.')),
      tabIds.length ? h('p', { class: 'note' }, icon('info'), `${plural(tabIds.length, 'selected tab')} will be added.`) : null),
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: ws ? 'Save' : 'Create workspace', value: 'ok', kind: 'btn-primary' }],
    validate: () => {
      if (!name.value.trim()) return 'Name is required';
      const bad = parseRules().find((r) => !normalizeRulePattern(r));
      return bad ? `"${bad}" is not a valid domain (example: github.com)` : null;
    },
  });
  if (v !== 'ok') return null;
  const payload = { name: name.value.trim(), color, icon: iconName, openInNewWindow: newWindow.checked, rules: parseRules() };
  return ws
    ? attempt(() => send('workspaces.update', { id: ws.id, ...payload }), 'Workspace saved')
    : attempt(() => send('workspaces.create', { ...payload, tabIds }), (w) => `Created workspace "${w.name}"`);
}

export async function addToWorkspaceFlow(tabIds, workspaces, rulesEnabled) {
  if (!workspaces.length) return workspaceEditor({ tabIds, rulesEnabled });
  let choice = workspaces[0].id;
  const v = await openDialog({
    title: `Move ${plural(tabIds.length, 'tab')} to a workspace`,
    body: h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Workspace' },
      workspaces.map((w, i) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'ws-pick', checked: i === 0, onchange: () => { choice = w.id; } }),
        h('span', { class: 'dot', style: `background:${GROUP_HEX[w.color]}` }), icon(w.icon), h('span', {}, w.name))),
      h('p', { class: 'muted' }, 'Tabs join the workspace\'s Chrome tab group in their window. Pinned tabs are saved to the workspace but stay pinned (Chrome can\'t group pinned tabs).')),
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'New workspace…', value: 'new' }, { label: 'Move tabs', value: 'ok', kind: 'btn-primary' }],
  });
  if (v === 'new') return workspaceEditor({ tabIds, rulesEnabled });
  if (v !== 'ok') return null;
  return attempt(() => send('workspaces.addTabs', { id: choice, tabIds }), (w) => `Added to "${w.name}"`);
}
