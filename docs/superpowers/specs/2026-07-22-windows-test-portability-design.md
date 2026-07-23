# Windows Test Portability Design

**Date:** 2026-07-22

## Goal

Make the complete `wenlan-app` Vitest suite pass on a stock Windows checkout
without weakening any existing assertions, while preserving macOS and Linux
behavior and preventing future platform regressions in CI.

## Context

The physical Windows 11 run completed the native application smoke successfully,
but the fresh full Vitest run reported 22 failures:

- 18 in `scripts/prepare-sidecars.test.ts`
- one in `src/cssTokenGuard.test.ts`
- one in `src/i18n/hardcodedCopyGuard.test.ts`
- one in `src/reviewFlavor.test.ts`
- one in
  `src/components/memory/pages/wikiSpaceTypography.test.ts`

The failures are test-harness portability defects rather than product runtime
failures. They fall into four independently fixable classes: shell/native path
identity, platform PATH separators, a missing Unix `zip` executable, and source
files checked out with CRLF.

## Design

### 1. Canonical paths at comparison boundaries

Tests that compare repository-relative paths will convert separators to `/`
before building baseline keys. The on-disk baseline and known-exception formats
remain platform-neutral.

Tests that compare a path emitted by Git Bash will not attempt a lexical
`C:\...` to `/c/...` conversion. A test-only helper will ask the same Bash
runtime to canonicalize an existing directory with `pwd -P`. This preserves Git
for Windows mount semantics, including the `/tmp` alias, symlinks, and drive
letters.

No production path handling changes are required.

### 2. Native PATH construction

Every Node-spawned process environment will use `node:path.delimiter` when
prepending native executable directories. Git Bash remains responsible for
converting the inherited Windows PATH into its shell representation.

The helper will preserve the parent PATH unless a test intentionally replaces
it to prove a missing dependency.

### 3. Hermetic ZIP fixtures

`scripts/prepare-sidecars.test.ts` will stop invoking the external Unix `zip`
command. It will declare `fflate` as a direct dev dependency and use `zipSync`
to create the minimal Windows release archives in process.

The archive contents, filenames, checksums, extraction path, and negative
missing-`onnxruntime.dll` coverage remain unchanged. The test continues to
exercise the production extraction implementation; only fixture construction
becomes hermetic.

### 4. Normalize source text only when reading for textual guards

A small test helper under `src/test/` will:

- return repository-relative paths with `/` separators;
- normalize `\r\n` and lone `\r` to `\n` for source-text comparisons.

The helper is read-only. It will not rewrite the checkout and will not be used
for archives, images, or other binary fixtures.

The two exact multiline guards retain their current semantic assertions after
normalization. Regexes and expected selector text do not become more permissive.

### 5. Windows CI owns the regression gate

The Windows native-smoke workflow will run the complete `pnpm test` suite after
dependency installation and before Rust/WebDriver setup or native compilation.
The existing focused real-ZIP extraction test remains useful but no longer
stands in for the frontend suite.

macOS/Linux CI continues to run the same suite, so the helper abstractions must
remain neutral across all three operating systems.

## Error Handling

- A failed Bash canonicalization is a test setup error and must include stderr.
- Fixture ZIP creation errors fail immediately; no test is skipped because an
  archiver is unavailable.
- Invalid hardcoded-copy baseline rows continue to fail with the original row
  content.
- Source normalization is deterministic and has no fallback mode.

## Acceptance Gates

1. Reproduce the current focused failures before implementation.
2. Add focused helper tests and observe the expected red failures.
3. Run the five affected test files on physical Windows: zero failures and zero
   new skips.
4. Run the complete `pnpm test` suite on physical Windows: all tests green.
5. Run `pnpm build`.
6. Verify a CRLF checkout or equivalent CRLF fixture exercises the normalized
   source reader.
7. Keep macOS/Linux CI green.
8. Confirm the Windows workflow runs full Vitest before expensive native setup.

## Non-goals

- Changing production sidecar paths or archive extraction behavior.
- Reformatting the repository to LF on disk.
- Replacing Bash-based release scripts with PowerShell.
- Weakening source guards, baselines, sha256 checks, or required sidecar
  payloads.
