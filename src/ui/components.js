import { h, icon } from './dom.js';
import { isWebUrl } from '../core/url.js';

// ---------- theme ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let currentTheme = 'system';
export function applyTheme(theme) {
  currentTheme = theme || 'system';
  const dark = currentTheme === 'dark' || (currentTheme === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
darkQuery.addEventListener('change', () => applyTheme(currentTheme));

// ---------- formatting ----------

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function relTime(ts) {
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(ts);
}
export const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- small pieces ----------

export const GROUP_HEX = { grey: '#6b7280', blue: '#3b82f6', red: '#ef4444', yellow: '#eab308', green: '#22c55e', pink: '#ec4899', purple: '#8b5cf6', cyan: '#06b6d4', orange: '#f97316' };

/** Favicon from Chrome's local favicon cache; never fetched from the website. */
export function favicon(url) {
  if (!isWebUrl(url)) return h('span', { class: 'favicon favicon-generic' }, icon('globe', 14));
  return h('img', { class: 'favicon', alt: '', width: 16, height: 16, loading: 'lazy', src: chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`) });
}

export function button(label, { kind = '', iconName, onClick, title, disabled, small, type = 'button', ariaLabel } = {}) {
  return h('button', { type, class: `btn ${kind} ${small ? 'btn-sm' : ''} ${label ? '' : 'btn-icon'}`.trim(), onclick: onClick, title, disabled, 'aria-label': ariaLabel || (!label ? title : null) },
    iconName && icon(iconName, small ? 14 : 16), label && h('span', {}, label));
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 28)), h('h3', {}, title), text && h('p', {}, text), action);
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}` }, text);
}

export function checkbox({ checked, indeterminate, onChange, label, disabled }) {
  return h('input', { type: 'checkbox', class: 'check', checked, indeterminate, disabled, 'aria-label': label, onchange: (e) => onChange(e.target.checked), onclick: (e) => e.stopPropagation() });
}

// ---------- toasts ----------

let toastHost = null;
export function toast(message, kind = 'info') {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info'), h('span', {}, message));
  toastHost.append(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 7000 : 3500);
}

/** Runs an async action, reporting failures as an error toast. Returns the result or undefined. */
export async function attempt(fn, successMessage) {
  try {
    const r = await fn();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(r) : successMessage, 'success');
    return r;
  } catch (e) {
    toast(e.message || String(e), 'error');
    return undefined;
  }
}

// ---------- dialogs ----------

let dialogSeq = 0;
/**
 * Modal dialog built on <dialog>. Resolves with the clicked action's value, or null
 * when cancelled (Escape, close button). validate(value) may return an error message
 * to keep the dialog open.
 */
export function openDialog({ title, body, actions, wide = false, validate }) {
  return new Promise((resolve) => {
    const titleId = `dlg-title-${++dialogSeq}`;
    const error = h('p', { class: 'dialog-error', role: 'alert', hidden: true });
    const form = h('form', { method: 'dialog' },
      h('header', { class: 'dialog-head' }, h('h2', { id: titleId }, title),
        h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Close', onclick: () => dlg.close('') }, icon('x'))),
      h('div', { class: 'dialog-body' }, body, error),
      h('footer', { class: 'dialog-foot' }, actions.map((a) => h('button', {
        type: 'submit', value: a.value, class: `btn ${a.kind || ''}`, autofocus: a.autofocus, formnovalidate: a.value === 'cancel',
      }, a.label))));
    const dlg = h('dialog', { class: `dialog ${wide ? 'dialog-wide' : ''}`, 'aria-labelledby': titleId }, form);
    // Enter in a text field triggers the last (primary) action rather than the first button (Cancel).
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
        e.preventDefault();
        form.requestSubmit(form.querySelector('.dialog-foot button:last-child'));
      }
    });
    form.addEventListener('submit', (e) => {
      const value = e.submitter?.value ?? '';
      if (value && value !== 'cancel' && validate) {
        const msg = validate(value);
        if (msg) {
          e.preventDefault();
          error.textContent = msg;
          error.hidden = false;
        }
      }
    });
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      dlg.remove();
      resolve(v && v !== 'cancel' ? v : null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, details }) {
  const v = await openDialog({
    title,
    body: h('div', {}, h('p', {}, message), details),
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: confirmLabel, value: 'ok', kind: danger ? 'btn-danger' : 'btn-primary', autofocus: true }],
  });
  return v === 'ok';
}

export async function promptDialog({ title, label, value = '', placeholder = '', maxLength = 200, confirmLabel = 'Save' }) {
  const input = h('input', { class: 'input', value, placeholder, maxlength: maxLength, required: true, autofocus: true });
  const v = await openDialog({
    title,
    body: h('label', { class: 'field' }, h('span', {}, label), input),
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: confirmLabel, value: 'ok', kind: 'btn-primary' }],
    validate: () => (input.value.trim() ? null : `${label} is required`),
  });
  return v === 'ok' ? input.value.trim() : null;
}
