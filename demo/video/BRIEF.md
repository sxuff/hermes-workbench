---
workflow: general-video
flow: automation
storyboard: no
message: "The Hermes desktop app, in your browser, with one command"
destination: readme-and-social
aspect: 1920x1080
language: en
length: 15s
---

## Intent

A ~15s launch clip for the Hermes Workbench plugin, for the GitHub README and social posts, no voiceover. Scene 1: `hermes workbench` typed in a terminal. Scene 2: real footage of the browser app, where the user types a bug report and the agent streams, runs tools, patches code and reports tests passing. Close on the wordmark and the install commands.

## Assets

- ../out/app.mp4: real screen recording (1440x900, 31.4s) of the Workbench solving the demo bug, recorded by `demo/record.mjs` against the scripted demo model. Typing 0.7–4.4s, agent working 4.4–28.7s, result held to the end.

## Customizations

- Design matches the published images (`demo/compose.mjs`): Nous-blue gradient backdrop (#0a2a8a → #0053fd → #3b7bff), light browser frame with a URL pill reading 127.0.0.1:9119/workbench, Segoe UI, Collapse wordmark.

## Notes

- Inferred, not stated: 16:9 (fits README and X/LinkedIn); footage sped up about 3x to fit, with the agent's work genuine and only playback faster; end card with the two install commands.
- No personal data: footage comes from the isolated demo Hermes home.
