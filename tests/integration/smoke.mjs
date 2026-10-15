// End-to-end smoke test: launches Chrome with a throwaway profile, loads the unpacked
// extension over the DevTools protocol (pipe transport), and drives real Chrome APIs
// through the extension's own message interface. No dependencies, works offline.
//
//   node tests/integration/smoke.mjs            (set CHROME_PATH to override the browser)
//   HEADFUL=1 node tests/integration/smoke.mjs  (watch it run)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.SMOKE_OUT || join(ROOT, 'tests', 'integration', 'out');
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH.'); process.exit(2); }

// ---------- local test pages ----------
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)) || 'home';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Page ${name}</title><h1>${name}</h1>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- CDP over pipe ----------
const profile = mkdtempSync(join(tmpdir(), 'tabpilot-smoke-'));
const args = [
  `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--window-size=1400,900',
  ...(process.env.HEADFUL ? [] : ['--headless=new']), 'about:blank',
];
const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let stderr = '';
proc.stdio[2].on('data', (d) => { stderr += d; });
const pending = new Map();
const listeners = [];
let seq = 0;
let buf = '';
proc.stdio[4].on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  }
});
const cdp = (method, params = {}, sessionId) => new Promise((ok, reject) => {
  const id = ++seq;
  pending.set(id, { resolve: ok, reject, method });
  proc.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ---------- test runner ----------
const results = [];
const errors = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function attach(targetId) {
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  return sessionId;
}
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});

async function ev(sessionId, expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

let extId;
let page; // dashboard session
const call = (type, payload = {}) => ev(page, `import('/src/ui/api.js').then(m => m.send(${JSON.stringify(type)}, ${JSON.stringify(payload)}))`);
const allTabs = async () => (await call('state.get')).windows.flatMap((w) => w.tabs);
const openTab = (path, extra = {}) => ev(page, `chrome.tabs.create(${JSON.stringify({ url: `${BASE}/${path}`, active: false, ...extra })}).then(t => t.id)`);
const tabsAt = async (prefix) => (await allTabs()).filter((t) => t.url.startsWith(`${BASE}/${prefix}`));

async function openDashboard() {
  const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extId}/dashboard.html` });
  page = await attach(targetId);
  await waitFor(() => ev(page, `document.querySelector('.tab-row') !== null`), 'dashboard render');
  return targetId;
}

async function screenshot(name) {
  mkdirSync(OUT, { recursive: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false }, page);
  await sleep(400);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, page);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  console.log(`Chrome: ${CHROME}`);
  const version = await cdp('Browser.getVersion');
  console.log(`Version: ${version.product}\n`);

  await check('extension loads without manifest errors', async () => {
    ({ id: extId } = await cdp('Extensions.loadUnpacked', { path: ROOT }));
    assert(extId, 'no extension id');
  });
  await check('service worker starts', async () => {
    await waitFor(async () => (await cdp('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId)), 'service worker');
  });
  const swTarget = (await cdp('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  if (swTarget) await attach(swTarget.targetId);

  await openDashboard();
  await check('dashboard renders live tab list', async () => {
    assert((await allTabs()).length >= 1, 'no tabs');
  });

  // ---- search ----
  const ids = {};
  ids.invoice = await openTab('invoice-2024');
  ids.docs = await openTab('docs');
  ids.mail = await openTab('mail');
  await check('live tab search filters by title and URL', async () => {
    await waitFor(() => ev(page, `document.body.innerText.includes('Page invoice-2024')`), 'new tabs appear without refresh');
    await ev(page, `(() => { const i = document.querySelector('.search-input'); i.value = 'invoice'; i.dispatchEvent(new Event('input')); })()`);
    const titles = await waitFor(async () => {
      const t = await ev(page, `[...document.querySelectorAll('.tab-title')].map(e => e.textContent)`);
      return t.length && t.every((x) => x.toLowerCase().includes('invoice')) ? t : null;
    }, 'filtered results');
    assert(titles.includes('Page invoice-2024'), `got ${titles}`);
    await ev(page, `(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
  });
  await check('activating a result switches Chrome to that tab', async () => {
    await call('tabs.activate', { tabId: ids.docs });
    const t = (await allTabs()).find((x) => x.id === ids.docs);
    assert(t.active, 'tab not active');
  });

  // ---- duplicates ----
  await openTab('dup');
  await openTab('dup#section');
  await openTab('dup?utm_source=newsletter');
  await openTab('dup?id=2');
  await check('duplicates detected (fragment + tracking ignored, real query kept), nothing auto-closed', async () => {
    const { findDuplicateGroups } = { findDuplicateGroups: null };
    const groups = await ev(page, `import('/src/core/duplicates.js').then(async m => { const s = await (await import('/src/ui/api.js')).send('state.get'); return m.findDuplicateGroups(s.windows.flatMap(w => w.tabs)).map(g => g.tabs.length); })`);
    assert(JSON.stringify(groups) === '[3]', `groups ${JSON.stringify(groups)}`);
    await sleep(500);
    assert((await tabsAt('dup')).length === 4, 'a duplicate was closed automatically');
  });
  await check('protected page: no copy is closed by bulk close; unprotected: extras close', async () => {
    const dups = (await tabsAt('dup')).filter((t) => !t.url.includes('id=2'));
    // Protection is keyed by normalized page address, so it covers every copy.
    await call('tabs.protect', { urls: [dups[1].url], protected: true });
    const r1 = await call('tabs.close', { tabIds: [dups[1].id, dups[2].id], force: false });
    assert(r1.closed === 0 && r1.skipped === 2, JSON.stringify(r1));
    await call('tabs.protect', { urls: [dups[1].url], protected: false });
    const r2 = await call('tabs.close', { tabIds: [dups[1].id, dups[2].id], force: false });
    assert(r2.closed === 2, JSON.stringify(r2));
    assert((await tabsAt('dup')).length === 2, 'expected original + ?id=2 to remain');
  });

  // ---- sessions ----
  let session;
  await check('save all windows as a session (persisted)', async () => {
    const pinId = await openTab('pinned-page', { pinned: true });
    assert(pinId, 'pin tab');
    session = await call('sessions.save', { name: 'Smoke session', scope: 'all' });
    const list = await call('sessions.list');
    assert(list.some((s) => s.id === session.id), 'not in list');
    const tabs = session.windows.flatMap((w) => w.tabs);
    assert(tabs.some((t) => t.url.endsWith('/pinned-page') && t.pinned), 'pinned state not saved');
    assert(!tabs.some((t) => t.url.startsWith('chrome-extension://')), 'own dashboard was saved');
  });
  await check('restore session into a new window with pinned + active state', async () => {
    const before = (await tabsAt('pinned-page')).length;
    const w = { tabs: [
      { url: `${BASE}/pinned-page`, title: 'p', pinned: true, active: false },
      { url: `${BASE}/restored-a`, title: 'a', pinned: false, active: false },
      { url: `${BASE}/restored-b`, title: 'b', pinned: false, active: true },
    ] };
    const r = await call('restore', { windows: [w], newWindow: true });
    assert(r.opened === 3 && r.failed.length === 0 && r.windows === 1, JSON.stringify(r));
    const state = await call('state.get');
    const win = state.windows.find((x) => x.tabs.some((t) => t.url.endsWith('/restored-b')));
    assert(win, 'restored window missing');
    assert(win.tabs.length === 3, `expected exactly 3 tabs (blank tab removed), got ${win.tabs.length}`);
    assert(win.tabs[0].pinned && win.tabs[0].url.endsWith('/pinned-page'), 'pinned tab not first/pinned');
    assert(win.tabs.find((t) => t.url.endsWith('/restored-b')).active, 'active tab not restored');
    assert((await tabsAt('pinned-page')).length === before + 1, 'pinned count');
  });
  await check('restore multiple windows keeps window separation', async () => {
    const before = (await call('state.get')).windows.length;
    const r = await call('restore', { windows: [{ tabs: [{ url: `${BASE}/w1` }] }, { tabs: [{ url: `${BASE}/w2a` }, { url: `${BASE}/w2b` }] }], newWindow: true });
    assert(r.windows === 2 && r.opened === 3, JSON.stringify(r));
    const state = await call('state.get');
    assert(state.windows.length === before + 2, 'window count');
    const w2 = state.windows.find((x) => x.tabs.some((t) => t.url.endsWith('/w2a')));
    assert(w2.tabs.some((t) => t.url.endsWith('/w2b')) && !w2.tabs.some((t) => t.url.endsWith('/w1')), 'tabs mixed between windows');
  });
  await check('unsupported URLs are reported, not opened; restorable ones still open', async () => {
    const r = await call('restore', { windows: [{ tabs: [{ url: 'javascript:alert(1)' }, { url: 'chrome://kill' }, { url: `${BASE}/ok-after-bad` }] }] });
    assert(r.opened === 1 && r.failed.length === 2, JSON.stringify(r));
  });
  await check('invalid restore payload is rejected by validation', async () => {
    let msg = '';
    try { await call('restore', { windows: [{ tabs: [{ url: 42 }] }] }); } catch (e) { msg = e.message; }
    assert(/must be text/.test(msg), `got "${msg}"`);
  });
  await check('rename and delete session', async () => {
    await call('sessions.rename', { id: session.id, name: 'Renamed' });
    assert((await call('sessions.list')).find((s) => s.id === session.id).name === 'Renamed', 'rename');
    const keep = await call('sessions.save', { name: 'Keep me', scope: 'tabs', tabIds: [ids.mail] });
    await call('sessions.delete', { id: session.id });
    const list = await call('sessions.list');
    assert(!list.some((s) => s.id === session.id) && list.some((s) => s.id === keep.id), 'delete');
  });

  // ---- workspaces ----
  let ws;
  await check('create workspace from selected tabs -> native tab group', async () => {
    ws = await call('workspaces.create', { name: 'Smoke Dev', color: 'purple', icon: 'code', openInNewWindow: false, tabIds: [ids.docs, ids.mail], rules: ['github.com'] });
    const state = await call('state.get');
    const g = state.groups.find((x) => x.title === 'Smoke Dev');
    assert(g && g.color === 'purple', 'group not created');
    const grouped = state.windows.flatMap((w) => w.tabs).filter((t) => t.groupId === g.id).map((t) => t.id).sort();
    assert(JSON.stringify(grouped) === JSON.stringify([ids.docs, ids.mail].sort()), `grouped ${grouped}`);
    assert(ws.tabs.length === 2, 'saved tabs');
  });
  await check('workspace syncs when a tab joins its group', async () => {
    const extra = await openTab('ws-extra');
    const g = (await call('state.get')).groups.find((x) => x.title === 'Smoke Dev');
    await ev(page, `chrome.tabs.group({ groupId: ${g.id}, tabIds: [${extra}] })`);
    await waitFor(async () => (await call('workspaces.list')).find((w) => w.id === ws.id).tabs.some((t) => t.url.endsWith('/ws-extra')), 'workspace sync');
  });
  await check('rename workspace renames its live group', async () => {
    await call('workspaces.update', { id: ws.id, name: 'Smoke Dev 2', color: 'cyan' });
    const g = (await call('state.get')).groups.find((x) => x.title === 'Smoke Dev 2');
    assert(g && g.color === 'cyan', 'group not renamed');
    let dupErr = '';
    const other = await call('workspaces.create', { name: 'Other', color: 'blue', icon: 'book', openInNewWindow: false });
    try { await call('workspaces.update', { id: other.id, name: 'smoke dev 2' }); } catch (e) { dupErr = e.message; }
    assert(/already exists/.test(dupErr), 'duplicate name allowed');
    await call('workspaces.delete', { id: other.id });
  });
  await check('switch to workspace focuses its group', async () => {
    const r = await call('workspaces.open', { id: ws.id });
    assert(r.focused, JSON.stringify(r));
  });
  await check('delete workspace ungroups tabs without closing them; sessions untouched', async () => {
    const sessionsBefore = (await call('sessions.list')).length;
    const r = await call('workspaces.delete', { id: ws.id });
    assert(r.ungrouped === 3, JSON.stringify(r));
    const tabs = await allTabs();
    assert(tabs.some((t) => t.id === ids.docs && t.groupId === -1) && tabs.some((t) => t.id === ids.mail), 'tabs closed or still grouped');
    assert((await call('sessions.list')).length === sessionsBefore, 'sessions changed');
  });
  await check('reopen a closed workspace restores its saved tabs as a group', async () => {
    const w = await call('workspaces.create', { name: 'Reopen', color: 'green', icon: 'book', openInNewWindow: true, tabIds: [await openTab('reopen-1'), await openTab('reopen-2')] });
    const g = (await call('state.get')).groups.find((x) => x.title === 'Reopen');
    const inGroup = (await allTabs()).filter((t) => t.groupId === g.id).map((t) => t.id);
    await ev(page, `chrome.tabs.remove(${JSON.stringify(inGroup)})`);
    await sleep(1200);
    const r = await call('workspaces.open', { id: w.id });
    assert(r.opened === 2, JSON.stringify(r));
    const g2 = await waitFor(async () => (await call('state.get')).groups.find((x) => x.title === 'Reopen'), 'group recreated');
    assert((await allTabs()).filter((t) => t.groupId === g2.id).length === 2, 'tabs not grouped');
  });
  await check('automatic grouping rule applies once after load (opt-in)', async () => {
    const w = await call('workspaces.create', { name: 'Rules', color: 'orange', icon: 'globe', openInNewWindow: false, rules: ['127.0.0.1'] });
    const offId = await openTab('rule-off');
    await sleep(1500);
    assert((await allTabs()).find((t) => t.id === offId).groupId === -1, 'rule applied while disabled');
    await call('settings.set', { patch: { rulesEnabled: true } });
    const onId = await openTab('rule-on');
    await waitFor(async () => {
      const s = await call('state.get');
      const g = s.groups.find((x) => x.title === 'Rules');
      return g && s.windows.flatMap((x) => x.tabs).find((t) => t.id === onId).groupId === g.id;
    }, 'rule grouping');
    await call('settings.set', { patch: { rulesEnabled: false } });
    await call('workspaces.delete', { id: w.id });
  });

  // ---- cleanup ----
  await check('discard skips active, protected and pinned tabs; unloads others', async () => {
    const state = await call('state.get');
    const tabs = state.windows.flatMap((w) => w.tabs);
    const active = tabs.find((t) => t.active && t.url.startsWith(BASE));
    const pinned = tabs.find((t) => t.pinned);
    const plain = tabs.find((t) => t.url.endsWith('/invoice-2024'));
    const prot = tabs.find((t) => t.url.endsWith('/restored-a'));
    await call('tabs.protect', { urls: [prot.url], protected: true });
    const r = await call('tabs.discard', { tabIds: [active.id, pinned.id, plain.id, prot.id] });
    assert(r.discarded === 1, JSON.stringify(r));
    const reasons = r.skipped.map((s) => s.reason).sort().join('|');
    assert(reasons === 'Active tab|Pinned|Protected', reasons);
    // Chrome may give a discarded tab a new id, so look tabs up by URL.
    const after = await allTabs();
    assert(after.find((t) => t.url === plain.url).discarded, 'plain tab not discarded');
    assert(!after.find((t) => t.url === active.url && t.active)?.discarded, 'active discarded!');
    assert(!after.find((t) => t.url === prot.url).discarded, 'protected discarded!');
    await call('tabs.protect', { urls: [prot.url], protected: false });
  });

  // ---- recovery ----
  let snapCount;
  await check('recovery snapshot persisted after tab changes', async () => {
    await call('recovery.snapshotNow');
    const snaps = await call('recovery.list');
    snapCount = snaps.length;
    assert(snaps.length >= 1 && snaps[0].tabCount > 5, JSON.stringify(snaps.map((s) => s.tabCount)));
    assert(!snaps[0].windows.flatMap((w) => w.tabs).some((t) => t.url.startsWith('chrome-extension://')), 'own pages in snapshot');
  });
  await check('rapid event burst does not create a snapshot per event', async () => {
    const before = (await call('recovery.list')).length;
    for (let i = 0; i < 6; i++) await openTab(`burst-${i}`);
    await sleep(4000);
    const after = (await call('recovery.list')).length;
    assert(after - before <= 1, `snapshots grew by ${after - before}`);
  });
  await check('settings change persists', async () => {
    await call('settings.set', { patch: { theme: 'dark', recoveryRetention: 7 } });
    const s = await call('settings.get');
    assert(s.theme === 'dark' && s.recoveryRetention === 7, JSON.stringify(s));
  });
  await screenshot('dashboard-dark');
  const findSw = async () => (await cdp('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  const assertDataIntact = async () => {
    const snaps = await call('recovery.list');
    assert(snaps.length >= snapCount, `snapshots lost: ${snaps.length} < ${snapCount}`);
    assert((await call('sessions.list')).some((s) => s.name === 'Keep me'), 'sessions lost');
    assert((await call('settings.get')).recoveryRetention === 7, 'settings lost');
    assert((await call('workspaces.list')).some((w) => w.name === 'Reopen'), 'workspaces lost');
  };
  await check('service worker termination: worker restarts on demand, data intact', async () => {
    await cdp('ServiceWorker.enable', {}, page);
    await cdp('ServiceWorker.stopAllWorkers', {}, page);
    await waitFor(async () => !(await findSw()), 'service worker to stop');
    await assertDataIntact(); // this message wakes a fresh worker
    assert(await findSw(), 'worker did not restart');
  });
  await check('snapshots and data survive an extension reload', async () => {
    const swBefore = await findSw();
    const { id } = await cdp('Extensions.loadUnpacked', { path: ROOT });
    assert(id === extId, 'extension id changed');
    await waitFor(async () => {
      const sw = await findSw();
      return sw && sw.targetId !== swBefore?.targetId;
    }, 'service worker restart');
    await openDashboard();
    await assertDataIntact();
  });
  // ---- backup ----
  await check('export / import round trip and invalid import rejected', async () => {
    const data = await call('backup.export');
    assert(data.format === 'tabpilot-backup' && data.sessions.length >= 1, 'export');
    let msg = '';
    try { await call('backup.import', { data: { format: 'x' }, mode: 'merge' }); } catch (e) { msg = e.message; }
    assert(/not a TabPilot backup/.test(msg), msg);
    await call('data.reset', { confirm: 'RESET' });
    assert((await call('sessions.list')).length === 0, 'reset');
    const r = await call('backup.import', { data, mode: 'replace' });
    assert(r.sessions === data.sessions.length, JSON.stringify(r));
    assert((await call('sessions.list')).some((s) => s.name === 'Keep me'), 'import');
  });

  // ---- UI views render without errors ----
  await call('settings.set', { patch: { theme: 'light' } });
  for (const view of ['tabs', 'workspaces', 'sessions', 'duplicates', 'cleanup', 'recovery', 'settings']) {
    await check(`view "${view}" renders`, async () => {
      await ev(page, `location.hash = '${view}'`);
      await sleep(350);
      const txt = await ev(page, `document.querySelector('main').innerText`);
      assert(!/Something went wrong|Couldn't load/.test(txt), txt.slice(0, 200));
      await screenshot(`view-${view}`);
    });
  }
  await check('restore preview and workspace editor dialogs open and cancel cleanly', async () => {
    await ev(page, `location.hash = 'sessions'`);
    await sleep(300);
    await ev(page, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Preview & restore')).click()`);
    await waitFor(() => ev(page, `!!document.querySelector('dialog[open] .pick-row')`), 'restore dialog');
    await screenshot('dialog-restore');
    await ev(page, `document.querySelector('dialog[open]').close('')`);
    await ev(page, `location.hash = 'workspaces'`);
    await sleep(300);
    await ev(page, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('New workspace')).click()`);
    await waitFor(() => ev(page, `!!document.querySelector('dialog[open] .swatches')`), 'workspace dialog');
    await screenshot('dialog-workspace');
    await ev(page, `document.querySelector('dialog[open]').close('')`);
    await sleep(100);
    assert(await ev(page, `!document.querySelector('dialog')`), 'dialog not removed');
  });
  await check('popup renders tab list and search', async () => {
    const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
    const pop = await attach(targetId);
    await waitFor(() => ev(pop, `document.querySelectorAll('.popup-list .tab-row').length > 3`), 'popup rows');
    await ev(pop, `(() => { const i = document.querySelector('.search-input'); i.value = 'invoice'; i.dispatchEvent(new Event('input')); })()`);
    await waitFor(async () => (await ev(pop, `[...document.querySelectorAll('.popup-list .tab-title')].map(e => e.textContent)`)).join() === 'Page invoice-2024', 'popup search');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 600, deviceScaleFactor: 1, mobile: false }, pop);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, pop);
    writeFileSync(join(OUT, 'popup.png'), Buffer.from(data, 'base64'));
  });

  await check('no uncaught errors in extension pages or service worker', async () => {
    const real = errors.filter((e) => !/Receiving end does not exist/.test(e));
    assert(!real.length, real.join('\n'));
  });
} catch (e) {
  console.error('\nSmoke test aborted:', e.message);
  if (stderr) console.error(stderr.slice(-2000));
  results.push({ name: 'run', ok: false, error: e.message });
} finally {
  proc.kill();
  server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
