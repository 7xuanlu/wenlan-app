---
name: verify
description: Evidence recipe for verifying wenlan-app changes in the real running desktop app. The handle file the built-in verify protocol expects; launch/drive primitives live in the run-wenlan-app skill.
---

# Verifying wenlan-app — launch, drive, evidence

Launch + drive: use the `run-wenlan-app` skill
(`.claude/skills/run-wenlan-app/driver.sh` — build / launch / shot / stop).
Hard rules from that skill apply here too: never kill the user's daemon on
:7878, never `pnpm clean:dev`, no global coordinate clicks (shared desktop).

Evidence by change type:

- UI change: `driver.sh shot /tmp/shot.png`, then LOOK at the pixels — a blank
  frame means the frontend did not load. The screenshot IS the evidence.
- Frontend logic: `pnpm test` (Vitest); browser flows: `pnpm test:e2e` (Playwright).
- Tauri command / Rust side: `cd app && cargo test`, then one real invoke through
  the running app when the command is user-reachable.
- i18n: `pnpm test:i18n`.

Gotchas:

- Synthetic CGEvents are not handled by Tauri's WKWebView — drive UI state only
  through the driver's documented paths.
- The app talks to the LIVE daemon on :7878. Daemon-side changes are verified in
  the wenlan repo (its verify/prove skills), never through the app.
