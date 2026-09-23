# Demo visuals

Everything in `docs/media` comes from real Hermes runs, not mockups. Hermes runs its real agent loop against a scripted model (`mock_model.py`), so the tool calls actually execute inside a small sample project (`project/`, "acme-shop", with a real rounding bug). The transcript, diff and test output are genuine; only the model's words are scripted. No personal data is involved: the demo uses its own throwaway `HERMES_HOME`.

| File | Makes |
| --- | --- |
| `mock_model.py` | OpenAI-compatible streaming server (port 18990), standard library only |
| `project/` | acme-shop: `cartTotal` sums float prices, so 3 × $1.15 + $12.50 at 10% tax comes to $17.54 instead of $17.55 |
| `capture.mjs` | 2x screenshots of four sessions, the `/` menu and the model picker |
| `compose.mjs` | `banner.png` (1200×600, plugin catalog) and `hero.png` (1600×900, README) from a screenshot |
| `record.mjs` | `out/app.mp4`, a screen recording of the bug fix, footage for the clip |
| `video/` | the 15-second launch clip, rendered locally and not committed ([HyperFrames](https://github.com/heygen-com/hyperframes) composition) |

## Setup (Windows, Git Bash)

A short drive letter keeps paths in the transcript clean.

```sh
mkdir -p "$TEMP/hwb-demo" && MSYS_NO_PATHCONV=1 subst W: "$(cygpath -w "$TEMP/hwb-demo")"
```

Demo home, `W:\home\config.yaml` (the plugin installed into it with `node scripts/install.mjs --hermes-home W:/home`):

```yaml
model: { provider: demo, default: local-model, base_url: http://127.0.0.1:18990/v1 }
providers:
  demo: { name: Local, base_url: http://127.0.0.1:18990/v1, model: local-model,
          transport: chat_completions, discover_models: false, models: { local-model: {} } }
terminal: { cwd: 'W:\acme-shop' }
plugins: { enabled: [hermes-workbench] }
```

## Run

```sh
python demo/mock_model.py &                                   # scripted model
HERMES_HOME='W:\home' hermes workbench --port 9219 --no-browser
```

Reset before every capture or recording: stop the backend, delete `W:\home\state.db*` and `W:\home\sessions`, and recreate the project as a fresh git repository.

```sh
HERMES_HOME='W:\home' hermes workbench stop --port 9219
rm -rf W:/home/state.db* W:/home/sessions W:/acme-shop && cp -r demo/project W:/acme-shop
(cd W:/acme-shop && git init -q -b master && git add -A && git commit -qm "chore: acme-shop 2.3.1")
```

Then, with the backend started again:

```sh
node demo/capture.mjs demo/out/raw          # screenshots
node demo/compose.mjs demo/out/raw/session.png docs/media
node demo/record.mjs demo/out/app.mp4       # reset again first
```

## The clip

`video/` is a HyperFrames project: a terminal typing `hermes workbench`, the recording (typing at 2x, the agent at 5x, the result at 1x with a push-in), and an end card. It needs two local files that aren't committed: `assets/app.mp4` (copy `demo/out/app.mp4`) and `assets/fonts/Collapse-Bold.woff2` (the Nous display face, from `node_modules/@nous-research/ui/dist/fonts` in a Hermes checkout).

```sh
cd demo/video
npx hyperframes check
npx hyperframes render --quality delivery --video-frame-format png -o renders/launch.mp4
```

Clean up: `HERMES_HOME='W:\home' hermes workbench stop --port 9219`, stop the mock model, then `MSYS_NO_PATHCONV=1 subst W: /D`.
