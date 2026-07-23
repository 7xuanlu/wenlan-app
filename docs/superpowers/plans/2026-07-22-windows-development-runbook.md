# Windows Development Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible Windows developer runbook backed by the physical Windows 11 validation of PR #96, and make it discoverable from both README and AGENTS.md.

**Architecture:** Keep durable developer instructions in one new `docs/windows-development.md` file. README exposes the human entry point, while root `AGENTS.md` routes coding agents to the same canonical runbook and keeps test limitations visible.

**Tech Stack:** Markdown, PowerShell 7, Node.js 24, pnpm 10, Rust 1.95/MSVC, Tauri 2, WebView2, Vitest, `tauri-driver`, and the sibling `7xuanlu/wenlan` Rust workspace.

## Global Constraints

- Document only behavior observed on the physical Windows 11 Home build 26200 run or directly proven by the checked-out source.
- Keep the native-smoke claim separate from installer, signing, updater, Windows-on-login, and production-support claims.
- State that the current Windows `llama-cpp-2` build is CPU/OpenMP-only; CUDA and Vulkan are not compiled into the default backend.
- Record the full Vitest result and classify failures without presenting them as product-runtime failures.
- Do not modify product code or tests in this task.
- Do not overwrite or stage the user's untracked `.agents/` directory or unrelated working-tree changes.

---

### Task 1: Write the canonical Windows development runbook

**Files:**
- Create: `docs/windows-development.md`
- Reference: `.github/workflows/windows-smoke.yml`
- Reference: `scripts/windows/native-smoke.mjs`
- Reference: sibling `../wenlan/crates/wenlan-core/Cargo.toml`

**Interfaces:**
- Consumes: PR #96's Windows workflow, sidecar staging scripts, native-smoke evidence contract, and physical-machine evidence under `target/windows-native-smoke/`.
- Produces: one canonical document for Windows prerequisites, source builds, live smoke execution, GPU status, test interpretation, troubleshooting, evidence, and cleanup.

- [ ] **Step 1: Write the verified-machine and claim-boundary sections**

Record Windows 11 Home build 26200, x86_64, WebView2/EdgeDriver `150.0.4078.83`, `tauri-driver 2.0.6`, app commit `e655fd28f70c6e253744cc2f1fbfc90185480fd9`, backend commit `c66f9d8e3e2edc991a540a89d3c5f60e2c109a99`, and the distinction between physical Windows 11 evidence and the workflow's hard-coded Windows Server 2022 claim.

- [ ] **Step 2: Write the prerequisite and checkout sections**

Document Git-for-Windows Bash precedence over `C:\Windows\System32\bash.exe`, LF checkout requirements, Node/pnpm/Rust versions, MSVC C++ tools, CMake/Ninja, vcpkg sqlite, libclang, Strawberry Perl, WebView2, and the required sibling `wenlan` checkout.

- [ ] **Step 3: Write exact build and native-smoke commands**

Mirror the checked-in workflow's source-backend build, ONNX Runtime staging, manifest creation, Tauri release build, matching EdgeDriver setup, `tauri-driver` launch, and `pnpm test:native:windows` invocation. Include the required environment variables and isolation directories.

- [ ] **Step 4: Record GPU behavior and test interpretation**

Explain that the default non-macOS dependency enables only `sampler`, resulting in `gpu_layers=0` and CPU/OpenMP on Windows even with an RTX 3060. Record the fresh Vitest result `1587 passed, 22 failed, 1 skipped` and classify the 22 failures into Git-Bash path representation, POSIX `PATH` construction, absent Unix `zip`, Windows path separators, and CRLF-sensitive text assertions.

- [ ] **Step 5: Add troubleshooting, evidence, and cleanup**

Cover the hf-hub completed-`.part`/HTTP 416 failure, `onnxruntime.dll` placement, backend/app version warning, model prewarm, port/process cleanup, test-created profile paths, and the assertions required before calling a run passed.

### Task 2: Add human and agent entry points

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/windows-development.md`.
- Produces: a visible README development-doc link and an agent routing row plus Windows-specific operational notes.

- [ ] **Step 1: Link the runbook from README**

Add a short Development documentation section after Build that links to `docs/windows-development.md` and identifies it as the physical Windows setup/build/live-smoke guide.

- [ ] **Step 2: Link the runbook from AGENTS.md**

Add `docs/windows-development.md` to `WHERE TO LOOK`. Add concise conventions/notes stating that Windows native validation must use the documented source-built sidecar and evidence contract, and that a green frontend build is not equivalent to a green full Vitest suite on Windows.

### Task 3: Verify the documentation change

**Files:**
- Verify: `docs/windows-development.md`
- Verify: `README.md`
- Verify: `AGENTS.md`

**Interfaces:**
- Consumes: the three documentation changes.
- Produces: machine-checked links, clean Markdown whitespace, and a narrowly scoped Git diff.

- [ ] **Step 1: Check required content and links**

Run:

```powershell
rg -n "windows-development\.md" README.md AGENTS.md
rg -n "1587 passed|22 failed|CPU/OpenMP|c66f9d8e|e655fd28" docs/windows-development.md
```

Expected: both entry points reference the runbook and every evidence/limitation marker is present.

- [ ] **Step 2: Check whitespace and scope**

Run:

```powershell
git diff --check
git diff -- README.md AGENTS.md docs/windows-development.md docs/superpowers/plans/2026-07-22-windows-development-runbook.md
```

Expected: no whitespace errors and no product-code or test changes in the task diff.

- [ ] **Step 3: Commit only the documentation files**

Run:

```powershell
git add -- README.md AGENTS.md docs/windows-development.md docs/superpowers/plans/2026-07-22-windows-development-runbook.md
git diff --cached --check
git commit -m "docs: add Windows development runbook"
```

Expected: one local documentation-only commit; `.agents/`, `.fastembed_cache/`, `app/Cargo.toml`, and unrelated files remain unstaged.
