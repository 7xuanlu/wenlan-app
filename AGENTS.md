# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-06T04:40:22Z
**Commit:** e579048
**Branch:** HEAD (detached)

## OVERVIEW

Wenlan desktop app: a Tauri 2 Rust crate in `app/` plus one React 19 / Vite 6 /
Tailwind v4 frontend package in `src/`. The daemon and shared server crates live
in the separate public `7xuanlu/wenlan` repo; this repo owns the desktop shell,
sidecar packaging, UI, and app-to-daemon bridge.

## STRUCTURE

```text
wenlan-app/
|-- app/                 # Tauri crate, sidecar declarations, Rust commands
|-- src/                 # React UI, Tauri invoke wrappers, i18n, tests
|-- scripts/             # sidecar, backend-pin, version-lock contracts
|-- e2e/                 # Playwright specs, wired by playwright.config.ts
|-- preview/             # browser fixture/live preview harness on :1421
|-- docs/windows-development.md # canonical physical Windows build/smoke runbook
|-- docs/superpowers/    # living plans, specs, and generated inventories
`-- .github/workflows/   # CI, release, backend pin automation
```

`pnpm-workspace.yaml` exists, but this is not a multi-package workspace.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Rust/Tauri runtime | `app/AGENTS.md`, `app/src/lib.rs` | startup, tray, plugins, invoke handler |
| Daemon HTTP bridge | `app/src/api.rs`, `src/lib/tauri.ts` | typed app-to-server boundary |
| Main product UI | `src/components/memory/AGENTS.md` | navigation, settings, citations, sources |
| General frontend | `src/AGENTS.md` | Vite, Tailwind v4, i18n, Vitest patterns |
| Sidecars/release | `scripts/AGENTS.md` | backend pin, sha256, cloudflared, release scripts |
| Browser E2E | `e2e/AGENTS.md`, `playwright.config.ts` | CI runs Chromium tests on Vite |
| Preview harness | `preview/AGENTS.md`, `vite.preview.config.ts` | Tauri API shims, fixture states |
| Windows build/native smoke | `docs/windows-development.md`, `.github/workflows/windows-smoke.yml` | physical setup, portable tests, source-built backend, WebView2 evidence |
| Historical plans | `docs/superpowers/` | do not treat generated inventories as product docs |

## CODE MAP

LSP returned Rust symbols for `app/src/search.rs` and `app/src/api.rs`.
TypeScript document-symbol requests timed out in this session; CodeGraph tools
were not exposed to the main session, so numeric reference centrality is not
recorded here.

| Symbol | Type | Location | Refs | Role |
| --- | --- | --- | --- | --- |
| `run` | function | `app/src/lib.rs` | n/a | Tauri builder, plugins, tray, windows, command registration |
| `WenlanClient` | struct | `app/src/api.rs` | n/a | typed HTTP client to the daemon on `:7878` |
| `search` and command handlers | functions | `app/src/search.rs` | n/a | largest Tauri command surface |
| `Main` | React component | `src/components/memory/Main.tsx` | n/a | primary in-app navigation shell |
| `App` | React component | `src/App.tsx` | n/a | top-level window mode and event wiring |
| Tauri wrappers | functions | `src/lib/tauri.ts` | n/a | frontend command payload and response shapes |

## CONVENTIONS

- Root `Cargo.toml` is only a workspace wrapper; the app crate is `app/`.
- Vite dev server is fixed at `:1420` with `strictPort: true`; preview uses
  `vite.preview.config.ts` on `:1421`.
- Tailwind v4 is CSS-first through `src/index.css`; there is no
  `tailwind.config.*`.
- TypeScript is strict and no-emit. `pnpm build` is `tsc -b && vite build`.
- Vitest uses jsdom and `src/test/setup.ts`. Coverage thresholds apply only to
  the whitelisted modules in `vitest.config.ts`, not the whole tree.
- CI creates empty sidecar placeholders for compile-time Tauri checks; real
  daemon binaries are covered separately by the download-smoke job.
- Windows native validation must follow `docs/windows-development.md` and use
  its source-built sidecar manifest plus process/module/UI evidence contract.
- Windows CI must run the full `pnpm test` gate before Rust/native smoke work;
  follow the runbook's path, shell, line-ending, and platform-assertion rules.
- Release versions must stay aligned across `package.json`, `app/Cargo.toml`,
  `app/tauri.conf.json`, and `.wenlan-backend-version`.

## ANTI-PATTERNS (THIS PROJECT)

- Do not assume backend source exists here. Use `WENLAN_BACKEND_DIR` or the
  pinned release asset path.
- Do not treat CI placeholder sidecars as proof the daemon runtime works.
- Do not bypass `src/lib/tauri.ts` for new frontend IPC calls.
- Do not weaken sha256, updater, or version-lock checks to get a release green.
- Do not add generated inventory output under `docs/superpowers/refactor/` by
  hand; use the owning script.

## COMMANDS

```bash
pnpm dev:all
pnpm build
pnpm test
pnpm test:i18n
pnpm test:e2e
pnpm exec tsc -b
cd app && cargo test
cargo fmt --check --all
cargo clippy --workspace --all-targets -- -D warnings
```

## NOTES

- `WENLAN_BACKEND_DIR` must point at a checkout containing
  `crates/wenlan-server`, `crates/wenlan-mcp`, and `crates/wenlan-cli`.
- `TAURI_SIGNING_PRIVATE_KEY` and password are required for updater artifacts.
- `app/Cargo.toml` pins `wenlan-types`, but the daemon binary comes from either
  a sibling checkout or `.wenlan-backend-version`; no runtime version handshake
  currently proves they match.
