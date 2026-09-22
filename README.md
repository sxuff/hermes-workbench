# Hermes Workbench

Browser-native session workbench for Hermes Agent. A dashboard plugin, not an embedded TUI and not a separate agent runtime.

## Implemented

- Session create/list/search/resume, workspace directory, rename and fork.
- Streaming Markdown, reasoning, tool cards, send/queue/steer/interrupt.
- Approval and clarification cards. Secure secret/sudo entry is intentionally not collected.
- Session-scoped subagent list and controls.
- Tab-scoped native session identity restoration after refresh; automatic socket reconnect.
- Responsive layout and browser fullscreen.
- Native Hermes dashboard styling: live background/midground theme tokens, inherited typography, square controls, uppercase mono labels, and the Hermes Agent wordmark. No separate hardcoded Workbench palette.

## Build and install

Requires Node, npm, and a Hermes dashboard with the SDK/native WebSocket methods supported by Hermes v0.21.0. Uses host React, not a bundled React runtime.

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run install:plugin
hermes plugins enable hermes-workbench
```

Install copies only this plugin to `$HERMES_HOME/plugins/hermes-workbench` (or the default Hermes home). Enable without granting built-in tool overrides. Refresh dashboard plugin discovery and open `/workbench`. No core source edits or gateway restart required. The plugin inherits dashboard authentication and uses SDK `buildWsUrl('/api/ws')`.

## Verified on the installed runtime

- 18 deterministic adapter/reducer tests, TypeScript check, production build.
- Real native browser session: terminal writes and reads `WORKBENCH_NATIVE_OK`.
- Real UI: create, rename, send, clarification choice/answer, reload mid-task, native resume, terminal side effect `WORKBENCH_UI_OK`, final transcript.
- Same durable session identity before/after reload.
- Desktop and 390px-wide mobile screenshots, no horizontal Workbench overflow, no JavaScript page errors, no iframe or xterm.

Local evidence is in `evidence/native-smoke.json` and `evidence/ui-smoke.json`; screenshots `workbench-desktop.png` and `workbench-mobile.png`. Evidence is excluded from distribution because live environment captures can contain private session titles. `scripts/native-smoke.mjs` and `scripts/ui-smoke.mjs` are opt-in live tests: they create real sessions and consume the configured model. Their default URL/path/browser executable target the development host and must be adapted on other hosts.

## Safety and limits

- Default profile only. No cross-profile writes.
- No public listener, credential changes, tunnel, startup service, commit or push is installed by this project.
- Single-user trusted-host interface. Client-side preflight is not a server-side atomic multi-user lease. Existing live sessions belonging to other clients are refused; non-leaf session history is refused before native resume can redirect it. Concurrent same-account control races still require gateway-level leases to eliminate.
- Browser identity bookmarks are IDs, not credentials, and live only in sessionStorage. They survive refresh in the same tab, not arbitrary new-device takeover.
- Snapshot recovery is not a claim of lossless token replay. Completion events arriving during resume are buffered and applied after the snapshot; uncertain outgoing mutations are never retried automatically.
- Approval decisions are fail-closed and covered by transport fixtures, but dangerous-command approvals and delegated-agent controls have not been exercised in the live end-to-end run.
- Subagent controls require native ownership evidence. Missing evidence hides control rather than guessing ownership.
- No file explorer, diff editor, artifact preview, image uploads, model picker, or multi-user access management in this first build. The host dashboard remains available for its existing management functions.

## Implementation

`src/client.ts`: small JSON-RPC adapter implemented against installed Hermes native methods; `src/state.ts`: pure event projection; `src/app.tsx`: host React UI with DOMPurify-sanitized Markdown; `src/style.css`: scoped styles. Native contract/source references are recorded in `src/CLIENT-CONTRACT.md` and the adapter header.
