import { h, icon } from '../ui/dom.js';
import { send } from '../ui/api.js';
import { attempt, button, confirmDialog, openDialog, toast, plural } from '../ui/components.js';

const save = (patch, msg = 'Settings saved') => attempt(() => send('settings.set', { patch }), msg);

function toggle(label, desc, key, s) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'setting-label' }, label), desc && h('div', { class: 'muted' }, desc)),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: s[key], 'aria-label': label, onchange: (e) => save({ [key]: e.target.checked }) }), h('span', { class: 'switch-track' })));
}

function number(label, desc, key, s, { min, max, unit }) {
  const input = h('input', { class: 'input input-num', type: 'number', min, max, step: 1, value: s[key], 'aria-label': label });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < min || v > max) {
      toast(`${label} must be a whole number from ${min} to ${max}`, 'error');
      input.value = s[key];
      return;
    }
    save({ [key]: v });
  });
  return h('div', { class: 'setting' }, h('div', {}, h('div', { class: 'setting-label' }, label), desc && h('div', { class: 'muted' }, desc)), h('div', { class: 'num-wrap' }, input, h('span', { class: 'muted' }, unit)));
}

async function exportData() {
  const data = await attempt(() => send('backup.export'));
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `tabpilot-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Exported ${plural(data.sessions.length, 'session')} and ${plural(data.workspaces.length, 'workspace')}`, 'success');
}

function importData() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return toast('That file is too large to be a TabPilot backup', 'error');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('That file is not valid JSON', 'error');
    }
    const mode = await openDialog({
      title: 'Import backup',
      body: h('div', { class: 'stack' },
        h('p', {}, `File: ${file.name}`),
        h('p', {}, h('strong', {}, 'Merge'), ' adds the backup\'s workspaces and sessions to what you have (same items are overwritten). ', h('strong', {}, 'Replace'), ' deletes your current workspaces, sessions, and protected pages first.'),
        h('p', { class: 'muted' }, 'Settings from the backup are applied in both cases. Recovery snapshots are not part of backups.')),
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Replace', value: 'replace', kind: 'btn-danger' }, { label: 'Merge', value: 'merge', kind: 'btn-primary', autofocus: true }],
    });
    if (!mode) return;
    if (mode === 'replace' && !(await confirmDialog({ title: 'Replace all data?', message: 'Your current workspaces, saved sessions, and protected pages will be deleted and replaced by the backup.', confirmLabel: 'Replace', danger: true }))) return;
    attempt(() => send('backup.import', { data, mode }), (r) => `Imported ${plural(r.sessions, 'session')} and ${plural(r.workspaces, 'workspace')}`);
  });
  document.body.append(input);
  input.click();
}

async function resetData() {
  const confirmInput = h('input', { class: 'input', placeholder: 'RESET', autocomplete: 'off' });
  const v = await openDialog({
    title: 'Reset TabPilot?',
    body: h('div', { class: 'stack' },
      h('p', {}, 'This permanently deletes all workspaces, saved sessions, recovery snapshots, protected pages, and settings. Your open tabs are not touched.'),
      h('p', { class: 'muted' }, 'Consider exporting a backup first.'),
      h('label', { class: 'field' }, h('span', {}, 'Type RESET to confirm'), confirmInput)),
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete everything', value: 'ok', kind: 'btn-danger' }],
    validate: () => (confirmInput.value === 'RESET' ? null : 'Type RESET (capital letters) to confirm'),
  });
  if (v === 'ok') attempt(() => send('data.reset', { confirm: 'RESET' }), 'All TabPilot data was reset');
}

export function renderSettings(ctx) {
  const s = ctx.store.settings;
  if (!s) return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading settings…');
  return h('div', { class: 'view view-narrow' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'muted' }, 'Changes save automatically.'))),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Appearance'),
      h('div', { class: 'setting' }, h('div', {}, h('div', { class: 'setting-label' }, 'Theme')),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' }, [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([v, label, ic]) =>
          h('label', { class: s.theme === v ? 'is-on' : '' }, h('input', { type: 'radio', name: 'theme', value: v, checked: s.theme === v, onchange: () => save({ theme: v }, null) }), icon(ic, 14), label))))),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Recovery'),
      toggle('Automatic snapshots', 'Save your open windows after changes and on a schedule.', 'recoveryEnabled', s),
      number('Snapshot interval', 'Scheduled snapshot frequency (changes also trigger snapshots).', 'recoveryIntervalMinutes', s, { min: 1, max: 60, unit: 'minutes' }),
      number('Snapshots to keep', 'Older snapshots are deleted automatically.', 'recoveryRetention', s, { min: 1, max: 100, unit: 'snapshots' }),
      toggle('Offer recovery after restart', 'If Chrome restarts and your previous tabs didn\'t come back, show a restore prompt (badge on the toolbar icon).', 'startupPrompt', s)),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Cleanup'),
      toggle('Skip pinned tabs', null, 'excludePinned', s),
      toggle('Skip tabs playing audio', null, 'excludeAudible', s),
      toggle('Automatic cleanup', 'Off by default. When on, tabs inactive longer than the limit below are unloaded every few minutes, with the same exclusions. Active and protected tabs are never unloaded.', 'autoDiscardEnabled', s),
      number('Automatic cleanup after', null, 'autoDiscardMinutes', s, { min: 15, max: 43200, unit: 'minutes inactive' })),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Workspaces & duplicates'),
      toggle('Automatic grouping rules', 'Group new pages into workspaces by their rule domains.', 'rulesEnabled', s),
      toggle('Ignore tracking parameters when finding duplicates', 'utm_*, gclid, fbclid and similar. Other query parameters always count.', 'stripTrackingParams', s)),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Keyboard shortcuts'),
      h('ul', { class: 'shortcuts' },
        h('li', {}, h('kbd', { class: 'kbd' }, 'Alt+Shift+T'), ' Quick search popup'),
        h('li', {}, h('kbd', { class: 'kbd' }, 'Alt+Shift+D'), ' Open dashboard'),
        h('li', {}, h('kbd', { class: 'kbd' }, 'Alt+Shift+S'), ' Save current window'),
        h('li', {}, h('kbd', { class: 'kbd' }, '/'), ' Search (in dashboard)  ', h('kbd', { class: 'kbd' }, '↑ ↓'), ' Move through results  ', h('kbd', { class: 'kbd' }, 'Enter'), ' Go to tab')),
      h('p', { class: 'muted' }, 'Defaults may be taken by other extensions. ',
        h('button', { type: 'button', class: 'linkish', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Change shortcuts in Chrome'))),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Backup & data'),
      h('div', { class: 'note note-warn' }, icon('alert'), h('span', {}, 'Backup files contain the addresses and titles of pages you saved, which can be sensitive. Store them carefully.')),
      h('div', { class: 'row-actions' },
        button('Export backup', { iconName: 'download', onClick: exportData }),
        button('Import backup', { iconName: 'upload', onClick: importData }),
        button('Reset all data…', { iconName: 'trash', kind: 'btn-danger-ghost', onClick: resetData }))),

    h('section', { class: 'card settings-card' }, h('h2', {}, 'Privacy'),
      h('p', {}, 'TabPilot works entirely on this computer. It has no server, no account, and no analytics. Tab addresses, titles, and sessions are never sent anywhere. Favicons come from Chrome\'s local cache. Passwords, cookies, and page contents are never read or stored.')));
}
