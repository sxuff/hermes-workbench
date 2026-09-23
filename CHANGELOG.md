# Changelog

All notable changes to Hermes Workbench are documented here.

## 0.2.0 - 2026-09-23

First tagged release.

### The desktop interface in your browser

- `hermes workbench` opens the Hermes desktop app's own interface (sessions, bots and group chats, `/` commands, model picker, attachments, skills, cron, approvals) in a browser tab, served by the Hermes dashboard. A shim stands in for the Electron bridge and reports a remote connection, so the desktop's own remote-host paths handle attachments, file trees and git diffs.
- `hermes workbench build` makes a web-only desktop build that needs no Electron download, native compiling or C++ toolchain. It copies the desktop sources into its own workspace, installs dependencies from Hermes's lockfile with install scripts disabled using Hermes's managed Node, and runs Vite. The Hermes checkout is only read. The first `hermes workbench` builds automatically, and later runs rebuild when Hermes changes.
- The command reuses a running dashboard or starts one on loopback in the background. It stops only a backend it started, and asks before restarting one you started.
- Profiles: `hermes workbench open NAME` opens straight into a profile, and the desktop's profile rail switches between them. Every call is scoped to the profile in the page URL. One install in the default profile covers all profiles.
- `status`, `stop`, `build`, `--port` and `--no-browser` for SSH use.

### Built-in interface

- Restyled after the Hermes desktop app's design system: the Nous palette, type scale, Tabler icons and the Collapse wordmark, in light and dark.
- Tool calls render inside the turn that ran them, instead of piling up at the bottom of the chat.
- Covers the whole window instead of sitting inside the dashboard page. Still reachable at `/workbench?ui=classic` when a desktop build is present.

### Fixes

- The manifest declares `manifest_version: 1`, which Hermes 0.21 installers require.
- The profile is a positional argument (`hermes workbench open NAME`), because Hermes consumes `--profile` anywhere on the command line.
- New desktop sessions keep their workspace directory: the shim's `sanitizeWorkspaceCwd` returns the same shape as Electron's.
- The status bar no longer shows a "client vweb" version.

### Publishing

- Installs from GitHub with `hermes plugins install sxuff/hermes-workbench --enable`.
- A catalog banner, README hero and screenshots, made from real Hermes runs against a scripted model (`demo/`).
- MIT license file, CI, `CONTRIBUTING.md` and `SECURITY.md`.

## 0.1.0 - 2026-09-22

Untagged preview: a browser-native Workbench as a Hermes dashboard plugin, using the dashboard's authenticated gateway socket. Session create, list, resume, rename and fork; streaming Markdown and reasoning; tool calls with diffs; queue, steer and stop; approval and clarification widgets; live todos and subagent controls.
