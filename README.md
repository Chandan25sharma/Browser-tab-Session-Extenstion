# TabPilot: Smart Tab & Session Manager

A local-first Chrome extension (Manifest V3) for people who keep dozens or hundreds of tabs open. It lets you:

- **Search open tabs** by title or address and jump straight to one.
- **Organize tabs into workspaces**, which are backed by native Chrome tab groups.
- **Save and restore sessions** for one window or all windows, keeping pinned tabs, tab groups, and the active tab.
- **Find duplicate tabs** and close the extra copies after reviewing them.
- **Recover after a crash or restart** from automatic snapshots.
- **Unload inactive tabs safely** to free memory.

It has no server, account, analytics, or network requests, and it works offline. All data stays on your computer.

The project is plain JavaScript (ES modules) with **no build step and no dependencies**. Chrome loads this folder as-is.

---

## Install on Windows 11

1. Download or copy this folder somewhere permanent, e.g. `D:\projects\tab-session`. Chrome loads it from that location, so don't delete it afterwards.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin TabPilot: click the puzzle-piece icon in the toolbar, then the pin next to **TabPilot**.

**Updating:** after changing files, click the circular **Reload** arrow on TabPilot's card in `chrome://extensions/`. Your data is kept.

**Requirements:** Chrome 121 or newer. Node.js is needed only to run the tests, not to use the extension.

### Using it

| Where | How |
|---|---|
| Quick popup | Click the toolbar icon or press **Alt+Shift+T**. Type to search, use ↑/↓ to move, press Enter to jump. |
| Full dashboard | **Dashboard** button in the popup, or **Alt+Shift+D** |
| Save current window | **Alt+Shift+S** (the badge flashes ✓) or the Save buttons |
| Dashboard search | Press **/** anywhere in the dashboard |
| Options | `chrome://extensions` → TabPilot → *Extension options* opens the dashboard's Settings |

You can change shortcuts at `chrome://extensions/shortcuts`. Another extension may already use a default.

---

## Features and how they behave

### Open tabs and search
- The list updates live and is grouped by window and tab group. Each row shows the favicon, title, address, and active/pinned/audible/unloaded/protected status.
- Search is a case-insensitive match on title and address. Multiple words must all match. Results update about 120 ms after you stop typing.
- Bulk actions on selected tabs: add to workspace, save as session, pin/unpin, protect/unprotect, unload, move to a new window, and close.
- Bulk close always keeps pinned and protected tabs open. The × button on a single tab closes it directly.

### Workspaces
- A workspace is a record that TabPilot stores: name, color, icon, saved tab list, and optional rules.
- When it is open, it appears as a **Chrome tab group with the same title**. Workspaces are linked to groups by title because Chrome's group IDs change after a restart. Workspace names are therefore unique.
- **Switch to** focuses the workspace's group and collapses other workspace groups in that window. If the workspace isn't open, it reopens the saved tabs as a group, in a new window or the current one, per the workspace setting.
- The saved tab list follows the live group: tabs you add to or remove from the group are reflected. If the group is closed, the last saved list is kept.
- **Deleting a workspace never closes tabs.** It ungroups them and leaves saved sessions untouched.
- Workspaces are **not** separate browser profiles. Cookies, logins, and site data are shared across all of them, and the UI says so.
- **Automatic grouping rules** are off by default.
  - Each workspace can list domains (e.g. `github.com`, which also matches subdomains).
  - When rules are on, a page joins the matching workspace's group after it finishes loading, so redirects settle first.
  - Only ungrouped, unpinned tabs are moved, and each tab only once per domain. If you take a tab out of the group, it stays out.
  - Browser-internal pages are never matched.

### Saved sessions
- Save this window, all windows, or the selected tabs. A save is acknowledged only after it is written to IndexedDB.
- **Preview & restore** shows every tab with checkboxes. You choose new windows or the current window.
- A restore recreates window separation, tab order, pinned tabs, tab groups (title and color), and the active tab.
- Unsupported addresses (`javascript:`, `data:`, crash/kill `chrome://` pages, etc.) are listed and skipped, never opened.
- Tabs that fail to open are reported with the reason and a **Retry** button. If you close the window mid-restore, the remaining tabs are reported instead of failing silently.
- Saved sessions are kept until you delete them, separate from recovery snapshots. TabPilot's own pages are never saved.

### Duplicates
- Addresses are compared after conservative normalization:
  - scheme and host are lower-cased, and the `#fragment` is removed;
  - known tracking parameters are removed: `utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_cid`, `igshid`, … (this can be turned off in Settings);
  - all other query parameters count, so `?id=1` and `?id=2` are different pages;
  - `http` and `https` stay different, and titles are never compared.
- **Close duplicates** keeps one copy: the active tab first, then pinned, then protected, then the most recently used.
- **Review** lets you tick the copies to keep.
- Every close asks for confirmation. Pinned and protected copies are never closed, and nothing closes automatically.

### Cleanup (unloading inactive tabs)
- Lists tabs that have been inactive longer than the duration you pick, using Chrome's `lastAccessed`.
- Skipped tabs are counted with the reason.
- The **active tab is never unloaded**. Protected tabs and tabs Chrome marks non-discardable are always skipped. Pinned tabs and tabs playing audio are skipped by default.
- Unloading uses `chrome.tabs.discard`: the tab stays in the strip and reloads when clicked. A confirmation is required, and it warns that unsaved form input may be lost.
- **No memory figures are shown.** Chrome does not expose per-tab memory to extensions, so TabPilot does not invent any.
- Automatic cleanup is opt-in and off by default. When on, it runs every 5 minutes with the same exclusions.

### Protected pages
- The lock button protects a page from bulk close, duplicate cleanup, and unloading.
- Protection is stored per normalized address, so it survives restarts and covers every open copy of that page. A lock icon marks protected tabs.

### Recovery
- Snapshots are taken a few seconds after tab or window changes (debounced), and on a schedule using `chrome.alarms` (default every 5 minutes).
- If nothing changed, no new snapshot is written. Small changes made within 5 minutes update the latest snapshot.
- Closing a window or several tabs at once keeps the previous snapshot, so the closed tabs can be recovered.
- Snapshots are separate from saved sessions, and only a bounded number are kept (default 10).
- **After a Chrome restart**, if most of the previous session's tabs did not come back, the toolbar icon shows a **!** badge. The popup and dashboard then offer *Review & restore*.
- The Recovery page also lists Chrome's own *recently closed* tabs and windows via `chrome.sessions`, as an extra source.
- Snapshots record addresses, pinned state, groups, and window layout. They **cannot** bring back form input, logins, or in-page state.

### Settings, backup, reset
- Settings: light, dark, or system theme; snapshot interval and retention; recovery prompt; cleanup options; rules; tracking-parameter handling.
- **Export** writes a JSON file with workspaces, sessions, protected pages, and settings. The page warns that the file contains browsing addresses.
- **Import** validates the whole file before writing anything, then either merges with or replaces your current data.
- **Reset** requires typing `RESET`.

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `tabs` | Read tab titles and addresses for the list, search, duplicates, sessions, and snapshots; activate, create, move, pin, close, and unload tabs. |
| `tabGroups` | Create, rename, color, collapse, and read native tab groups for workspaces and session restore. |
| `storage` | Settings and small state in `chrome.storage.local`; per-browser-session markers in `chrome.storage.session`. |
| `alarms` | Scheduled recovery snapshots, the post-restart recovery check, and optional automatic cleanup. These keep working when the MV3 service worker is asleep. |
| `sessions` | Optional extra recovery source: Chrome's list of recently closed tabs and windows. |
| `favicon` | Show favicons from Chrome's local favicon cache, so the UI never fetches anything from websites. |

There are **no host permissions and no content scripts**. TabPilot never reads page contents, cookies, passwords, or tokens. The extension pages' content security policy is `script-src 'self'`, so no remote code can run.

## Privacy

- No network requests are made by the extension. You can verify this in DevTools → Network on the dashboard, and by searching the code for `fetch(` or `XMLHttpRequest` (there are none).
- Data is stored in the extension's IndexedDB database (`tabpilot`: workspaces, sessions, recoverySnapshots, tabMetadata) and in `chrome.storage.local` (settings).
- Removing the extension deletes all of its data.

---

## Project structure

```
manifest.json            MV3 manifest
background.js            Service worker entry: registers listeners, routes messages
popup.html / dashboard.html / options.html
src/
  core/                  Pure logic, no Chrome APIs (unit-tested in Node)
    url.js               normalization, restorable-URL checks
    duplicates.js        duplicate groups, keeper choice, close planning
    sessions.js          window serialization, restore planning, fingerprints
    recovery.js          snapshot policy, recovery candidate, retention
    cleanup.js           discard eligibility
    rules.js             domain rules
    search.js            query matching
    validation.js        message and backup validation, settings schema
  storage/
    db.js                IndexedDB wrapper with versioned migrations
    settings.js          chrome.storage.local settings
  bg/                    Service-worker modules (Chrome APIs)
    handlers.js          one handler per message type
    tabs.js  restore.js  recovery.js  workspaces.js  alarms.js  util.js
  ui/                    Shared UI: DOM helper, icons, dialogs, toasts, API client, styles
  dashboard/             Dashboard shell and views
  popup/                 Quick popup
icons/                   Generated by scripts/make-icons.mjs
tests/unit/              node:test unit tests
tests/integration/       End-to-end smoke test in real Chrome
```

**Architecture:**
- UI pages never touch storage directly. They send typed messages (`{ type, ...payload }`) through `src/ui/api.js`.
- The service worker validates every message in `core/validation.js` before handling it, and is the only writer to IndexedDB.
- The service worker notifies open pages after writes. Pages also listen to tab and window events, so they update without a refresh.

## Testing

```powershell
npm test          # 52 unit tests (Node 18+; no install needed)
npm run smoke     # end-to-end test in real Chrome (about 1 minute)
```

`npm run smoke` launches your installed Chrome headless with a throwaway profile. It loads the extension through the DevTools protocol (`--remote-debugging-pipe --enable-unsafe-extension-debugging` + `Extensions.loadUnpacked`) and serves test pages from a local server.

It verifies installation, live search and activation, duplicates, session save/restore (multi-window, pinned, active, unsupported URLs), workspaces (groups, sync, rename, switch, delete, reopen, rules), cleanup safety, snapshots and event-burst debouncing, service-worker termination, extension reload persistence, backup/import/reset, every dashboard view, the popup, and that no uncaught errors occur.

Screenshots go to `tests/integration/out/`. Use `set HEADFUL=1` (cmd) or `$env:HEADFUL=1` (PowerShell) to watch it run, and `CHROME_PATH` to choose a different browser.

### Manual checklist (things automation can't cover)
1. **Restart recovery:**
   1. Set `chrome://settings/onStartup` to *Open the New Tab page*.
   2. Open several tabs and wait about 10 s.
   3. Quit Chrome from the menu, then start it again.
   4. Within about 30 s the toolbar icon shows **!** and the popup offers to restore.
2. **Crash recovery:**
   1. With tabs open, end `chrome.exe` in Task Manager.
   2. Reopen Chrome, and dismiss Chrome's own restore bubble.
   3. Expect the same TabPilot prompt.
3. **Keyboard:**
   - Alt+Shift+T opens the popup, and typing searches.
   - ↓ moves into the results, and Enter switches tabs.
   - In the dashboard, `/` focuses search, and Esc clears it.
4. **Dark mode:** switch Windows to dark mode with the theme set to *System*. The dashboard follows it.
5. **Privacy:** on the dashboard, open DevTools → Network, use every feature, and confirm there are no requests other than `chrome-extension://` files.

## Troubleshooting

- **"Service worker (Inactive)" on the extension card:** this is normal. MV3 workers sleep and wake on events. Click *service worker* to open its DevTools console.
- **Errors button on the extension card:** click it to see the message and file, fix the file, then click Reload. A common cause is selecting the wrong folder: choose the one containing `manifest.json`.
- **"TabPilot background service is unavailable":** the extension was reloaded while the page was open. Close and reopen the dashboard or popup.
- **Shortcuts don't work:** another extension took them. Set new ones at `chrome://extensions/shortcuts`.
- **Local `file://` pages won't restore:** enable *Allow access to file URLs* on TabPilot's card.
- **No favicons:** Chrome only has favicons for sites you have visited. Others show a globe.

## Known limitations

- **Failed page loads aren't detected.** Restore reports tabs Chrome refuses to create, but a page that opens and then fails (offline, 404) is not detected, because that would need the extra `webNavigation` permission. Chrome shows its own error page there.
- **Workspaces are matched by group title.** A tab group you create yourself with exactly a workspace's name is treated as that workspace.
- **Protection is per page address, not per tab.** Protecting a page covers all of its open copies.
- **Incognito windows aren't saved,** and the extension isn't enabled there unless you allow it.
- **Search is substring matching.** There is no fuzzy matching yet.
- **Recovery restores page addresses and window layout only.** It cannot restore form data, scroll position, or logins.
- **Tabs opened right before a crash may be missing.** The recovery prompt depends on snapshots saved before the shutdown: changes within the last few seconds (debounce), or since the last scheduled snapshot if the worker was asleep, may not be included.
