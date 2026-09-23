# Hermes Workbench

The Hermes desktop app, in your browser. `hermes workbench` opens the desktop app's own interface (sessions, bots and group chats, `/` commands, model picker, attachments, skills, cron, approvals) as a browser tab, served by your Hermes install. Useful on a headless server or VPS, on a machine where you can't install the desktop app, or on a tablet.

## Get started

```sh
hermes plugins install sxuff/hermes-workbench --enable
hermes workbench
```

The first `hermes workbench` builds the interface from your Hermes install (a few minutes, once; it needs Node, which Hermes installs for its dashboard anyway), starts the backend if needed, and opens your browser. After that it opens in seconds. When `hermes update` changes Hermes, the next `hermes workbench` refreshes the interface by itself (under a minute).

Profiles: switch them in the app's own profile rail, or open one directly with `hermes workbench --profile work`. The plugin only needs installing once, in your default profile.

```sh
hermes workbench --profile work   # open straight into a profile
hermes workbench status           # backend up? which interface?
hermes workbench stop             # stop the backend, only if `workbench` started it
hermes workbench build            # rebuild the interface by hand
hermes workbench --no-browser     # just print the URL (SSH)
```

## How it runs

One plugin, three parts:

- **`hermes workbench`** (`__init__.py`, `workbench_cli.py`) reuses a running Hermes dashboard server or starts one in the background (`hermes dashboard --no-open`), syncs the desktop interface, then opens `http://127.0.0.1:9119/workbench` for the current profile. `--port` picks another port; `--no-browser` only prints the URL (SSH).
- **The desktop interface.** The Hermes desktop app is Electron around an ordinary web app, and it reaches the OS only through one bridge object, `window.hermesDesktop`. The command copies a desktop build into the plugin, re-syncing whenever it changes, and injects `desktop-web/hermes-web-shim.js`. The build is whichever is newest of the Electron app's own (`apps/desktop/dist`, from `hermes desktop`) and a web-only one from `hermes workbench build`. The web-only build is what headless servers want: it copies the desktop sources into `~/.hermes/hermes-workbench/desktop-build`, installs their dependencies there with install scripts disabled (no Electron download, no native compiling, no C++ toolchain) using Hermes's managed Node, and runs Vite. Your Hermes checkout is only read, never installed into, so `hermes update` stays clean. Dependencies are cached until Hermes changes its lockfile; `hermes workbench` warns when the build is older than your Hermes, and offers to build when there is none. The shim stands in for the bridge: REST and the gateway socket go through the dashboard's authenticated SDK (loopback token and OAuth-gated dashboards both work), and it reports a remote connection, so the desktop's own remote-host paths handle the rest: attachments upload their bytes, file trees and git diffs come from the backend. Pasted, dropped and picked files live in memory. Because the build comes from your own Hermes sources, the interface matches your backend's version.
- **The page** (`dashboard/`) is a dashboard plugin. At `/workbench` it covers the whole window and shows the desktop interface in a same-origin frame, borrowing the dashboard's login. Without a desktop build it shows its own lighter interface instead (also at `/workbench?ui=classic`).

What doesn't carry over from Electron: separate windows, the terminal and browser side panes, the desktop pet, glass effects and in-app updates (update with `hermes update`). The shim is unofficial: a desktop release that changes the bridge may need a shim update.

`hermes serve` is not enough on its own: it is headless and serves no pages. If it holds the port, `hermes workbench` says so instead of opening a blank page.

On a remote host, run `hermes workbench open --no-browser` there and forward the port over SSH; never expose it publicly.

## Built-in interface

Shown when no desktop build is available, or at `/workbench?ui=classic`.

- Session create/list/search/resume, grouped by source, workspace directory, inline rename and fork. Typing on the empty screen starts a session.
- Streaming Markdown with code blocks (copy button), tables and lists; reasoning as a collapsible "Thought" row.
- Tool calls render inside the turn that ran them, with input, output and inline diffs. Runs of three or more settled tools collapse into one row.
- Send, and while a turn runs, queue or steer; stop.
- Approval and clarification widgets. Secure secret/sudo entry is intentionally not collected.
- Details panel with the session's live todo list and its subagents (steer/stop).
- Tab-scoped native session identity restoration after refresh; automatic socket reconnect.
- Full-window app layout, browser fullscreen, phone-width drawer. Every call is scoped to the profile in the URL.
- Styled after the Hermes desktop app (`apps/desktop/DESIGN.md`): its default Nous palette derived through the same `color-mix()` token chain, desktop type scale, Tabler icons and the Collapse wordmark. Light and dark follow the OS; the status bar toggles them.

## Develop

Requires Node and a Hermes dashboard with the SDK/native WebSocket methods of Hermes v0.21. The built-in UI uses host React, not a bundled React runtime; `dashboard/dist` is committed so installs need no build.

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run install:plugin        # copy this checkout into $HERMES_HOME/plugins/hermes-workbench
hermes plugins enable hermes-workbench
hermes workbench
```

A dashboard that was running before the plugin was installed doesn't serve it yet (plugins are discovered at startup). `hermes workbench` restarts a backend it started itself, and asks before restarting one you started.

The dashboard is one machine-level server that loads UI plugins from the default Hermes home, while CLI commands load per profile. `hermes workbench --profile NAME` covers other profiles from the default one; installing into a profile (`node scripts/install.mjs --hermes-home <profile home>`) is only needed for `hermes -p NAME workbench`.

## Verified on the installed runtime

- 18 deterministic adapter/reducer tests, TypeScript check, production build.
- Real native browser session: terminal writes and reads `WORKBENCH_NATIVE_OK`.
- Real UI: create, rename, send, clarification choice/answer, reload mid-task, native resume, terminal side effect `WORKBENCH_UI_OK`, final transcript.
- Same durable session identity before/after reload.
- Desktop and 390px-wide mobile screenshots, no horizontal Workbench overflow, no JavaScript page errors, no iframe or xterm.

`npm run smoke:desktop` checks, read-only, that the desktop interface still boots through the shim (run it after `hermes update`): no page errors, no failed requests, and it lists which bridge calls hit stubs.

`npm run smoke:fixture` needs no model: it opens the installed built-in interface in a real local dashboard page, replaces the gateway socket with a scripted fake, and plays a full turn (reasoning, streamed text, tools with a diff, todos, a clarify question and an approval) in light and dark, asserting timeline order and no page errors. Screenshots go to `evidence/fixture/`. It uses Playwright's `msedge` channel by default; set `PW_CHANNEL` to change it.

Local evidence is in `evidence/native-smoke.json` and `evidence/ui-smoke.json`; screenshots `workbench-desktop.png` and `workbench-mobile.png`. Evidence is excluded from distribution because live environment captures can contain private session titles. `scripts/native-smoke.mjs` and `scripts/ui-smoke.mjs` are opt-in live tests: they create real sessions and consume the configured model. Their default URL/path/browser executable target the development host and must be adapted on other hosts.

## Safety and limits

- Default profile only. No cross-profile writes.
- No public listener, credential changes, tunnel, startup service, commit or push is installed by this project.
- Single-user trusted-host interface. Client-side preflight is not a server-side atomic multi-user lease. Existing live sessions belonging to other clients are refused; non-leaf session history is refused before native resume can redirect it. Concurrent same-account control races still require gateway-level leases to eliminate.
- Browser identity bookmarks are IDs, not credentials, and live only in sessionStorage. They survive refresh in the same tab, not arbitrary new-device takeover.
- Snapshot recovery is not a claim of lossless token replay. Completion events arriving during resume are buffered and applied after the snapshot; uncertain outgoing mutations are never retried automatically.
- Approval decisions are fail-closed and covered by transport fixtures, but dangerous-command approvals and delegated-agent controls have not been exercised in the live end-to-end run.
- Subagent controls require native ownership evidence. Missing evidence hides control rather than guessing ownership.
- No file explorer, checkpoint diff review, artifact preview, attachments, slash commands, model picker, or multi-user access management yet. The host dashboard remains available for its existing management functions.

## Implementation

`src/client.ts`: small JSON-RPC adapter implemented against installed Hermes native methods; `src/state.ts`: pure event projection into an ordered per-session timeline; `src/app.tsx`: shell, layout and wiring; `src/ui/`: transcript, composer, sidebar, details panel, request widgets, DOMPurify-sanitized Markdown and icons; `src/style.css`: styles scoped under `.hwb`. Native contract/source references are recorded in `src/CLIENT-CONTRACT.md` and the adapter header.
