# Contributing

Hermes Workbench accepts focused bug fixes and improvements. It stays a thin layer: the desktop interface comes from your Hermes install, and this plugin only builds it, serves it and bridges it to the browser.

## Development

Requires Node 22 and a Hermes install (0.21 or later).

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run install:plugin        # copy this checkout into $HERMES_HOME/plugins/hermes-workbench
hermes plugins enable hermes-workbench
hermes workbench
```

`dashboard/dist` is committed so installs need no build. After changing `src/`, run `npm run build` and commit the refreshed `dashboard/dist` in the same change; CI fails when they drift.

A dashboard that was running before the plugin was installed doesn't serve it yet, because Hermes discovers plugins at startup. `hermes workbench` restarts a backend it started itself, and asks before restarting one you started.

The dashboard is one machine-level server that loads UI plugins from the default Hermes home, while CLI commands load per profile. `hermes workbench open NAME` covers other profiles from the default one. Installing into a profile (`node scripts/install.mjs --hermes-home <profile home>`) is only needed for `hermes -p NAME workbench`.

## Where things live

| Path | What |
| --- | --- |
| `__init__.py`, `workbench_cli.py` | the `hermes workbench` command: backend, desktop build, sync |
| `desktop-web/hermes-web-shim.js` | the browser stand-in for the desktop's `window.hermesDesktop` bridge |
| `src/` → `dashboard/dist` | the dashboard page and the built-in interface |
| `tests/` | reducer and client tests |
| `scripts/` | build, install and smoke tests |
| `demo/` | the scripted demo behind `docs/media` |

## The shim

The desktop interface reaches Electron only through `window.hermesDesktop`. The shim implements what the browser can do and stubs the rest. Stubbed calls are recorded in `window.__hermesWebShimMissing`. A desktop release that changes the bridge may need a shim update, so after `hermes update` run:

```sh
npm run smoke:desktop
```

It checks, read-only, that the desktop interface boots through the shim with no page errors or failed requests, and lists which bridge calls hit stubs.

## Before opening a pull request

```sh
npm run typecheck
npm test
npm run build                 # then commit dashboard/dist if it changed
npm run smoke:fixture         # if you touched the built-in interface
hermes plugins validate .
hermes plugins doctor . --ci
```

`smoke:fixture` needs no model: it plays a scripted turn against the installed built-in interface in light and dark, and asserts timeline order and no page errors. It uses Playwright's `msedge` channel by default; set `PW_CHANNEL` to change it.

`scripts/native-smoke.mjs` and `scripts/ui-smoke.mjs` are opt-in live tests. They create real sessions and consume your configured model, and their defaults target the development host.

Never commit credentials, session databases, transcripts, or screenshots of real sessions. Make visuals with the scripted demo instead (`demo/README.md`).

Use small commits with a short Conventional Commit subject such as `fix(shim): ...`, `feat: ...`, `docs: ...` or `test: ...`, with details in the body. Pull request titles follow the same format.

## Releasing

1. Bump `version` in `plugin.yaml` and `package.json`, and add a `CHANGELOG.md` section.
2. Merge, then tag the merge commit `vX.Y.Z` and publish a GitHub release with the changelog section.
3. Update the Hermes plugin catalog entry (`plugin-catalog/hermes-workbench.yaml` in NousResearch/hermes-agent) with a PR that bumps `sha` and `version` to the tagged commit.

The plugin must never update itself: users get new versions only through a reviewed catalog pin and `hermes plugins update`.
