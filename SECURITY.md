# Security policy

Hermes Workbench is a local, single-user interface to your own Hermes install. It is served by the Hermes dashboard, which binds to `127.0.0.1` by default. It is not designed for public hosting.

## Supported version

Only the latest tagged release is supported.

## Report a vulnerability

Use GitHub private vulnerability reporting on this repository. Do not open a public issue containing a credential, session token, prompt, transcript, path, or screenshot of private sessions.

## Trust boundary

- **No listener of its own.** The page is a dashboard plugin. It talks to Hermes only through the dashboard's authenticated SDK (the dashboard's session token, or its OAuth login), so it has exactly the access the dashboard grants. The plugin adds no authentication and no network listener.
- **Loopback by default.** A backend that `hermes workbench` starts runs `hermes dashboard --no-open` with the dashboard's default host, `127.0.0.1`. On a remote host, forward the port over SSH. Never bind it to a public interface or put it behind a public tunnel.
- **Backend lifecycle.** `hermes workbench stop` stops only a backend the command started, identified by process id and creation time. It asks before restarting a dashboard you started.
- **Build.** `hermes workbench build` reads the desktop sources from your Hermes checkout and never writes to it. It installs their dependencies from Hermes's own `package-lock.json`, with install scripts disabled, in a separate workspace under `~/.hermes/hermes-workbench/desktop-build`, then runs Vite. That requires npm registry access on the first build and whenever Hermes changes its lockfile.
- **No self-updates.** The plugin never fetches or replaces its own files. Updates arrive only through `hermes plugins update` at a reviewed commit.
- **Static assets.** The dashboard serves plugin assets, including the desktop bundle, without authentication at `/dashboard-plugins/hermes-workbench/`. They are code only, with no credentials or session data. The session token comes from the dashboard page at runtime.
- **Browser storage.** Files you paste, drop or pick live in page memory until they upload to your backend. The built-in interface keeps session ids, not credentials, in `sessionStorage`.
- **Prompts.** The built-in interface never answers sudo or secret prompts, and approval decisions fail closed.
