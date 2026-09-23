---
format: 1920x1080
duration: 15s
message: "The Hermes desktop app, in your browser, with one command"
arc: Command → App working → Install
audience: Hermes users on GitHub and X
mode: autonomous
---

## Frame 1 — One command

- status: outline
- src: compositions/frames/01-terminal.html
- duration: 2.8s
- transition_in: cut
- scene: `hermes workbench` typed in a terminal; it prints the Workbench URL.
- motion: code-terminal-run (registry; typed prompt + caret + output cue), ambient-glow-bloom (bloom-and-hold behind the panel)

Terminal panel on the Nous-blue field. The command types, executes, prints `Hermes Workbench: http://127.0.0.1:9119/workbench`.

## Frame 2 — The app does the work

- status: outline
- src: compositions/frames/02-app.html
- duration: 9.4s
- transition_in: cut
- scene: Browser window rises; real footage: the bug report is typed, Hermes runs tools and patches cart.js, tests pass; push in on the result.
- motion: nudge-curve (window rise), coordinate-target-zoom (push-in on the result table), ambient-glow-bloom (hero bloom behind the window)
- footage: ../out/app.mp4 as three segments — typing 0.5–4.6s at 2x, working 4.6–28.8s at 5x, result 28.8–31.3s at 1x

## Frame 3 — Install it

- status: outline
- src: compositions/frames/03-endcard.html
- duration: 3s
- transition_in: cut
- scene: HERMES WORKBENCH wordmark, tagline, the two install commands.
- motion: waterfall-entry (wordmark, tagline, commands), ambient-glow-bloom (bloom-and-hold behind the wordmark)
