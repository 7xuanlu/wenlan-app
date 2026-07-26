# Windows Test Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete `wenlan-app` Vitest suite green on stock Windows while preserving macOS/Linux behavior and adding a permanent Windows CI gate.

**Architecture:** Test-only helpers normalize path identity and source text at comparison boundaries. ZIP fixtures are generated in process with `fflate`, and the Windows native-smoke workflow runs full Vitest before expensive native setup.

**Tech Stack:** TypeScript, Node.js 24, Vitest 4, pnpm 10, fflate, Git Bash, GitHub Actions.

## Global Constraints

- Do not change production sidecar resolution, extraction, or checksum behavior.
- Do not weaken assertions, baselines, required payloads, or sha256 checks.
- Source normalization is read-only and text-only.
- Every bugfix follows red-green-refactor and retains a focused regression test.
- Preserve the user-owned untracked `.agents/` directory.

---

### Task 1: Platform-neutral source guard helpers

**Files:**
- Create: `src/test/sourceText.ts`
- Create: `src/test/sourceText.test.ts`
- Modify: `src/cssTokenGuard.test.ts`
- Modify: `src/i18n/hardcodedCopyGuard.test.ts`
- Modify: `src/reviewFlavor.test.ts`
- Modify: `src/components/memory/pages/wikiSpaceTypography.test.ts`

**Interfaces:**
- Produces: `toPosixPath(value: string): string`
- Produces: `repoRelativePath(file: string, cwd?: string): string`
- Produces: `normalizeSourceText(value: string): string`
- Produces: `readSourceText(file: string): string`

- [ ] **Step 1: Write focused failing helper tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeSourceText, toPosixPath } from "./sourceText";

describe("source text portability", () => {
  it("canonicalizes Windows separators for persisted keys", () => {
    expect(toPosixPath(String.raw`src\components\memory\PageInfo.tsx`))
      .toBe("src/components/memory/PageInfo.tsx");
  });

  it("normalizes CRLF and lone CR without changing other text", () => {
    expect(normalizeSourceText("one\r\ntwo\rthree\n"))
      .toBe("one\ntwo\nthree\n");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run src/test/sourceText.test.ts
```

Expected: FAIL because `src/test/sourceText.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

```ts
import { readFileSync } from "node:fs";
import { relative } from "node:path";

export function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function repoRelativePath(file: string, cwd = process.cwd()): string {
  return toPosixPath(relative(cwd, file));
}

export function normalizeSourceText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function readSourceText(file: string): string {
  return normalizeSourceText(readFileSync(file, "utf8"));
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
pnpm exec vitest run src/test/sourceText.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Route source guards through the helper**

Use `repoRelativePath(file)` in both path-key guards. Use `readSourceText(...)`
for exact source comparisons in `reviewFlavor.test.ts` and
`wikiSpaceTypography.test.ts`. Keep JSON parsing and the hardcoded-copy TSV read
on their existing readers unless the content itself is compared as source text.

- [ ] **Step 6: Run all affected source guards**

Run:

```powershell
pnpm exec vitest run src/test/sourceText.test.ts src/cssTokenGuard.test.ts src/i18n/hardcodedCopyGuard.test.ts src/reviewFlavor.test.ts src/components/memory/pages/wikiSpaceTypography.test.ts
```

Expected: all files pass; the hardcoded-copy guard reports zero new entries.

- [ ] **Step 7: Commit**

```powershell
git add -- src/test/sourceText.ts src/test/sourceText.test.ts src/cssTokenGuard.test.ts src/i18n/hardcodedCopyGuard.test.ts src/reviewFlavor.test.ts src/components/memory/pages/wikiSpaceTypography.test.ts
git commit -m "test: normalize source guards across platforms"
```

### Task 2: Shell path and PATH portability

**Files:**
- Create: `scripts/test-platform.ts`
- Create: `scripts/test-platform.test.ts`
- Modify: `scripts/prepare-sidecars.test.ts`

**Interfaces:**
- Produces: `canonicalBashPath(path: string): string`
- Produces: `prependNativePath(directory: string, inherited?: string): string`

- [ ] **Step 1: Write failing tests**

```ts
import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBashPath, prependNativePath } from "./test-platform";

describe("test platform helpers", () => {
  it("uses the host PATH delimiter", () => {
    expect(prependNativePath("fixture-bin", "parent-path"))
      .toBe(`fixture-bin${delimiter}parent-path`);
  });

  it("asks Bash for the canonical identity of an existing directory", () => {
    expect(canonicalBashPath(process.cwd())).toMatch(/^\//);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm exec vitest run scripts/test-platform.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement helpers without shell interpolation**

```ts
import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";

export function prependNativePath(
  directory: string,
  inherited = process.env.PATH ?? "",
): string {
  return inherited ? `${directory}${delimiter}${inherited}` : directory;
}

export function canonicalBashPath(path: string): string {
  return execFileSync(
    "bash",
    ["-lc", 'cd -- "$1" && pwd -P', "wenlan-test-path", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
```

- [ ] **Step 4: Verify helper GREEN**

Run:

```powershell
pnpm exec vitest run scripts/test-platform.test.ts
```

Expected: 2 passed on Windows Git Bash.

- [ ] **Step 5: Update sidecar test expectations and child PATH values**

Import both helpers. Canonicalize `appRoot` and `backendRoot` before comparing
them with shell output. Replace every `${directory}:${process.env.PATH}` and
`${binRoot}:/usr/bin:/bin` native environment construction with
`prependNativePath(...)`; preserve the deliberately restricted missing-
cloudflared test by deriving its Bash executable directories from the inherited
native PATH rather than hardcoding Unix PATH syntax.

- [ ] **Step 6: Verify the discovery and missing-dependency cases**

Run:

```powershell
pnpm exec vitest run scripts/test-platform.test.ts scripts/prepare-sidecars.test.ts -t "backend discovery|cloudflared"
```

Expected: discovery and missing-cloudflared cases pass; the failure case still
proves cargo is not reached and cloudflared is required.

- [ ] **Step 7: Commit**

```powershell
git add -- scripts/test-platform.ts scripts/test-platform.test.ts scripts/prepare-sidecars.test.ts
git commit -m "test: canonicalize Git Bash paths on Windows"
```

### Task 3: Hermetic Windows ZIP fixtures

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/prepare-sidecars.test.ts`

**Interfaces:**
- Consumes: `fflate.zipSync(data: Record<string, Uint8Array>): Uint8Array`
- Preserves: `buildFakeAssets(...): FakeAssets`

- [ ] **Step 1: Re-run the existing Windows ZIP failure**

Run:

```powershell
pnpm exec vitest run scripts/prepare-sidecars.test.ts -t "Windows"
```

Expected before implementation: FAIL with `spawnSync zip ENOENT`.

- [ ] **Step 2: Add a direct pinned dev dependency**

Run:

```powershell
pnpm add --save-dev --save-exact fflate@0.8.2
```

Expected: `package.json` and `pnpm-lock.yaml` contain direct `fflate` metadata.

- [ ] **Step 3: Replace the external `zip` process**

Add:

```ts
import { zipSync } from "fflate";
```

Replace the `execFileSync("zip", ...)` call with:

```ts
const entries = Object.fromEntries(
  windowsPayload.map((name) => [
    name,
    new Uint8Array(readFileSync(resolve(windowsContents, name))),
  ]),
);
writeFileSync(windowsBackend, zipSync(entries));
```

- [ ] **Step 4: Verify all download-mode behavior**

Run:

```powershell
pnpm exec vitest run scripts/prepare-sidecars.test.ts
```

Expected: the full file passes, including Windows extraction, missing DLL,
checksum, and staging assertions.

- [ ] **Step 5: Commit**

```powershell
git add -- package.json pnpm-lock.yaml scripts/prepare-sidecars.test.ts
git commit -m "test: generate sidecar zip fixtures in process"
```

### Task 4: Permanent Windows Vitest gate

**Files:**
- Modify: `.github/workflows/windows-smoke.yml`
- Modify: `docs/windows-development.md`

**Interfaces:**
- Produces: an early `pnpm test` Windows workflow step

- [ ] **Step 1: Add a source-contract assertion before editing the workflow**

Add this assertion to
`scripts/windows/workflow-contract.test.ts` inside the existing
`"builds the release-profile native target with an exact source-built backend"`
test:

```ts
const fullVitest = "run: pnpm test";
const rustSetup = "name: Install Rust 1.95.0";
expect(text).toContain(fullVitest);
expect(text.indexOf(fullVitest)).toBeLessThan(text.indexOf(rustSetup));
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm exec vitest run scripts/windows/workflow-contract.test.ts
```

Expected: FAIL because `windows-smoke.yml` only runs the ZIP extraction test.

- [ ] **Step 3: Add the early full-suite step**

```yaml
      - name: Run full frontend test suite on Windows
        run: pnpm test
```

Place it after frontend dependency installation and before Rust, WebDriver, or
native backend setup.

- [ ] **Step 4: Document the cross-platform contract**

In `docs/windows-development.md`, record that full Vitest is a required Windows
preflight and explain that path identity, PATH delimiters, ZIP fixtures, and
line endings must remain platform-neutral.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
pnpm exec vitest run scripts/windows/workflow-contract.test.ts
pnpm exec vitest run scripts/download-sidecars.test.ts scripts/prepare-sidecars.test.ts src/test/sourceText.test.ts src/cssTokenGuard.test.ts src/i18n/hardcodedCopyGuard.test.ts src/reviewFlavor.test.ts src/components/memory/pages/wikiSpaceTypography.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- .github/workflows/windows-smoke.yml scripts/windows/workflow-contract.test.ts docs/windows-development.md
git commit -m "ci: gate Windows smoke on full Vitest"
```

### Task 5: Full verification and PR #96 update

**Files:**
- Verify all files changed by Tasks 1-4

- [ ] **Step 1: Run typecheck and production build**

```powershell
pnpm build
```

Expected: `tsc -b` and Vite build both succeed.

- [ ] **Step 2: Run complete Vitest on physical Windows**

```powershell
pnpm test
```

Expected: zero failed files, zero failed tests, and no new skips.

- [ ] **Step 3: Check formatting and repository scope**

```powershell
git diff --check origin/main...HEAD
git status --short
```

Expected: diff check clean; only the pre-existing untracked `.agents/` remains.

- [ ] **Step 4: Push the existing PR head**

```powershell
git push origin HEAD:codex/windows-native-smoke
```

Expected: GitHub PR #96 updates without creating a second app PR.
