# Wenlan Page Editor Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the exact-source CodeMirror 6 Page editor on current `origin/main` and make Editing look and behave like the Wenlan Page itself.

**Architecture:** Keep `PageDetail` responsible for Page state, exact-source preparation, CAS persistence, recovery, and the Reading versus Editing transition. Keep CodeMirror behind the local `MarkdownEditor` adapter and lazy-load it only after Editing begins. Port additive editor files intact, but manually integrate current `PageDetail`, `Main`, Tauri, and Rust seams so the latest shell and PageDraft behavior remain authoritative.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, Tailwind v4 CSS tokens, Vitest, Playwright, Tauri 2, Rust, reqwest

## Global Constraints

- Work only in `/Users/lucian/Repos/wenlan-app/.worktrees/page-editor-latest-v2`.
- Preserve current `origin/main` Home, Wiki, Spaces, PageDraft, citations, links, revisions, menus, and localization.
- Direct CodeMirror and Phosphor dependencies use the exact versions in the approved spec.
- `ContentRenderer` remains the only Reading renderer.
- CodeMirror never owns serialization, persistence, Tauri calls, or daemon version checks.
- Stable daemon floor and all app versions are `0.14.1`.
- No user-facing Markdown, Source, or Live Preview mode toggle.
- No push or merge in this pass.

---

### Task 1: Restore the isolated editor foundation

**Files:**
- Create: `src/components/memory/editor/CodeMirrorMarkdownEditor.tsx`
- Create: `src/components/memory/editor/MarkdownEditor.tsx`
- Create: `src/components/memory/editor/MarkdownEditorToolbar.tsx`
- Create: `src/components/memory/editor/NativeMarkdownEditor.tsx`
- Create: `src/components/memory/editor/loadCodeMirrorEditor.ts`
- Create: `src/components/memory/editor/markdownCommands.ts`
- Create: `src/components/memory/editor/markdownSourceContract.ts`
- Create: `src/components/memory/editor/pageSaveCoordinator.ts`
- Create: `src/components/memory/editor/writingPresentation.ts`
- Create: corresponding colocated `*.test.ts` and `*.test.tsx` files
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `MarkdownEditor`, `MarkdownEditorHandle`, `MarkdownEditorStatus`, and `MarkdownEditorCommand`.
- Produces: `prepareMarkdownSource()` and `serializeMarkdownSource()` without source normalization.
- Produces: `beginPageSave()`, `pageDraftChanged()`, and `settlePageSave()` for single-flight typed saves.
- Produces: `writingPresentation()` for contextual Markdown decoration and task widgets.

- [ ] **Step 1: Restore the existing editor tests before production files**

Use the preserved worktree versions of the editor `*.test.ts` and `*.test.tsx`
files as the exact RED contract. Add this focus regression to
`writingPresentation.test.ts` if it is absent:

```ts
it("returns focus to the replacement task checkbox after a keyboard toggle", () => {
  const checkbox = view.dom.querySelector<HTMLInputElement>(
    ".cm-writing-task-checkbox",
  );
  expect(checkbox).not.toBeNull();
  checkbox!.focus();
  checkbox!.checked = true;
  checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
  expect(
    view.dom.querySelector<HTMLInputElement>(".cm-writing-task-checkbox"),
  ).toHaveFocus();
});
```

- [ ] **Step 2: Run the editor tests and confirm RED**

Run:

```bash
pnpm vitest run src/components/memory/editor
```

Expected: FAIL because the editor modules and direct dependencies do not yet
exist on current `origin/main`.

- [ ] **Step 3: Restore the adapter and exact-pinned dependencies**

Port the preserved editor implementation as additive files. Keep this dependency
surface exact:

```json
{
  "@codemirror/commands": "6.10.4",
  "@codemirror/lang-markdown": "6.5.1",
  "@codemirror/language": "6.12.4",
  "@codemirror/state": "6.7.1",
  "@codemirror/view": "6.43.6",
  "@lezer/highlight": "1.2.3",
  "@phosphor-icons/react": "2.1.10"
}
```

Keep `TaskCheckboxWidget` focused after its dispatch:

```ts
view.dispatch({
  changes: {
    from: this.from,
    to: this.to,
    insert: checkbox.checked ? "[x]" : "[ ]",
  },
  userEvent: "input",
});
view.dom
  .querySelector<HTMLInputElement>(
    `.cm-writing-task-checkbox[data-writing-task-from="${this.from}"]`,
  )
  ?.focus({ preventScroll: true });
```

- [ ] **Step 4: Run focused editor tests and TypeScript**

Run:

```bash
pnpm vitest run src/components/memory/editor
pnpm exec tsc -b
```

Expected: every editor test passes and TypeScript reports zero errors.

- [ ] **Step 5: Commit the isolated foundation**

```bash
git add package.json pnpm-lock.yaml src/components/memory/editor
git commit -m "feat: restore exact-source CodeMirror editor"
```

### Task 2: Restore the typed exact-source save bridge

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/lib/tauri.test.ts`
- Modify: `app/src/api.rs`
- Modify: `app/src/search.rs`
- Modify: `app/src/lib.rs`
- Modify: `app/Cargo.toml`
- Modify: `app/tauri.conf.json`
- Modify: `Cargo.lock`
- Modify: `.wenlan-backend-version`
- Modify: `preview/mocks/live-invoke.ts`

**Interfaces:**
- Consumes: serialized exact source and save snapshots from Task 1.
- Produces: `UpdatePageInput` with `id`, `content`, `expectedVersion`, `callerId`, and `operationId`.
- Produces: `UpdatePageOutcome` variants `saved`, `conflict`, `failure`, and `upgrade_required`.
- Produces: `recordPageEditorDiagnostic()` with content-free fields only.

- [ ] **Step 1: Restore bridge tests first**

Port the focused TypeScript and Rust tests that assert the wire request includes
the full CAS/idempotency identity and that HTTP status maps to typed outcomes.
The TypeScript request contract is:

```ts
export interface UpdatePageInput {
  id: string;
  content: string;
  expectedVersion: number;
  callerId: "wenlan-app";
  operationId: string;
}
```

The Rust request body is:

```rust
UpdatePageRequest {
    content,
    writer: "manual_edit".to_string(),
    expected_version: Some(expected_version),
    caller_id: Some(caller_id),
    operation_id: Some(operation_id),
}
```

- [ ] **Step 2: Run focused bridge tests and confirm RED**

Run:

```bash
pnpm vitest run src/lib/tauri.test.ts
cd app && cargo test page_update
```

Expected: FAIL because the current bridge accepts only `id` and `content`.

- [ ] **Step 3: Implement the typed bridge surgically**

Add the typed client call in `app/src/api.rs`, the Tauri commands in
`app/src/search.rs`, and register both in `app/src/lib.rs`. A successful save is
accepted only for a decodable `2xx` response with `ok: true` and `gated: false`.
Map HTTP `409` to conflict and keep the other status categories typed.

Add `record_page_editor_diagnostic` with no title, Page id, content, error text,
or source excerpt.

- [ ] **Step 4: Align the backend floor and app versions**

Set:

```text
.wenlan-backend-version:
v0.14.1
667e5cadafece24d520e098b1359e38d94adada8dbcf45913b836c925aa4c87e
```

Set version `0.14.1` in `package.json`, `app/Cargo.toml`,
`app/tauri.conf.json`, and the root lockfile. Pin `wenlan-types = "=0.14.1"`.

- [ ] **Step 5: Run bridge and Rust gates**

Run:

```bash
pnpm vitest run src/lib/tauri.test.ts
pnpm exec tsc -b
cd app && cargo test
cargo fmt --check --all
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all pass.

- [ ] **Step 6: Commit the bridge**

```bash
git add .wenlan-backend-version Cargo.lock app package.json preview/mocks/live-invoke.ts src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat: restore exact-source page save bridge"
```

### Task 3: Integrate Editing into the current Page shell

**Files:**
- Modify: `src/components/memory/PageDetail.tsx`
- Modify: `src/components/memory/Main.tsx`
- Create: `src/components/memory/PageDetail.CodeMirror.integration.test.tsx`
- Create: `src/components/memory/Main.PageDetail.pending.test.tsx`
- Modify: current `PageDetail.*.test.tsx` and `Main.*.test.tsx` only where the
  new behavior changes their public contract
- Modify: `src/i18n/resources.ts`
- Modify: `src/i18n/resources.test.ts`
- Modify: `src/i18n/hardcodedCopyBaseline.tsv`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: current published Page with guarded Reading and Editing states.
- Produces: `onSavePendingChange(pending)` and `onEditDirtyChange(dirty)` signals
  consumed by `Main`.

- [ ] **Step 1: Add integration RED tests**

Add assertions that enter Editing from the current Page header, see CodeMirror,
save through the typed bridge, retain a dirty draft on failures, and block pending
navigation. Keep the current PageDraft tests unchanged.

The global shortcut guard in `Main` must satisfy:

```ts
if (
  event.defaultPrevented ||
  event.isComposing ||
  event.target instanceof HTMLInputElement ||
  event.target instanceof HTMLTextAreaElement ||
  (event.target instanceof HTMLElement && event.target.isContentEditable)
) {
  return;
}
```

- [ ] **Step 2: Run focused integration tests and confirm RED**

Run:

```bash
pnpm vitest run \
  src/components/memory/PageDetail.CodeMirror.integration.test.tsx \
  src/components/memory/Main.PageDetail.pending.test.tsx
```

Expected: FAIL because the current Page still uses the native textarea and does
not expose the pending or dirty editor signals.

- [ ] **Step 3: Port the editor state machine into current `PageDetail`**

Manually integrate source preparation, version floor, editor session tokens,
document refs, save coordinator, conflict refetch, localized recovery, fallback,
and dirty/pending callbacks. Do not replace the current header, menus, attached
notice, citations, links, revisions, or current localized dateline.

Use `MarkdownEditor` only while Editing. Keep the existing `ContentRenderer`
branch unchanged while Reading.

- [ ] **Step 4: Port navigation guards into current `Main`**

Block Page replacement, sidebar/view navigation, search overlay replacement, and
quit while a save is pending. Ask before discarding a dirty Page edit. Preserve
the current PageDraft autosave and durability state.

- [ ] **Step 5: Add localized editor copy and Wenlan token styles**

Add the complete `pageDetail.editor` key set to English, Simplified Chinese, and
Traditional Chinese. Append editor styles using only existing semantic `--mem-*`
tokens.

- [ ] **Step 6: Run Page, Main, localization, and TypeScript tests**

Run:

```bash
pnpm vitest run src/components/memory/PageDetail src/components/memory/Main
pnpm test:i18n
pnpm exec tsc -b
```

Expected: all pass.

- [ ] **Step 7: Commit the shell integration**

```bash
git add src/components/memory/PageDetail.tsx src/components/memory/Main.tsx src/components/memory/*.test.tsx src/i18n src/index.css
git commit -m "feat: integrate page editing into current shell"
```

### Task 4: Apply the approved visual refinement RED-first

**Files:**
- Modify: `src/components/memory/editor/MarkdownEditorToolbar.tsx`
- Modify: `src/components/memory/editor/MarkdownEditorToolbar.test.tsx`
- Create: `src/components/memory/editor/pageEditorPresentation.ts`
- Create: `src/components/memory/editor/pageEditorPresentation.test.ts`
- Modify: `src/components/memory/PageDetail.tsx`
- Modify: `src/components/memory/PageDetail.CodeMirror.integration.test.tsx`
- Modify: `src/components/memory/editor/CodeMirrorMarkdownEditor.tsx`
- Modify: `src/components/memory/editor/NativeMarkdownEditor.tsx`
- Modify: `src/index.css`
- Modify: `src/i18n/resources.ts`

**Interfaces:**
- Produces: `leadingMarkdownH1MatchesTitle(source: string, title: string): boolean`.
- Produces: one-row toolbar DOM with format and persistence regions.

- [ ] **Step 1: Add duplicate-title RED tests**

```ts
expect(leadingMarkdownH1MatchesTitle("# Native Editor Review\n", "Native Editor Review")).toBe(true);
expect(leadingMarkdownH1MatchesTitle("\uFEFF\n#  Native   Editor Review  ##\r\n", "Native Editor Review")).toBe(true);
expect(leadingMarkdownH1MatchesTitle("## Native Editor Review\n", "Native Editor Review")).toBe(false);
expect(leadingMarkdownH1MatchesTitle("# Different\n", "Native Editor Review")).toBe(false);
```

In the Page integration test, assert the outer `.page-detail-title` is absent
only while Editing a matching leading H1.

- [ ] **Step 2: Add toolbar and action-center RED tests**

Assert one direct toolbar row:

```ts
const toolbar = screen.getByRole("toolbar", { name: labels.blockStyle });
expect(toolbar).toContainElement(screen.getByRole("button", { name: labels.bold }));
expect(toolbar).toContainElement(screen.getByRole("button", { name: labels.save }));
expect(toolbar.querySelector(".page-editor-toolbar-primary")).toBeNull();
```

While Editing, assert copy, export, re-distill, and overflow controls are absent
and the helper description has class `sr-only`.

- [ ] **Step 3: Run the visual-contract tests and confirm RED**

Run:

```bash
pnpm vitest run \
  src/components/memory/editor/pageEditorPresentation.test.ts \
  src/components/memory/editor/MarkdownEditorToolbar.test.tsx \
  src/components/memory/PageDetail.CodeMirror.integration.test.tsx
```

Expected: FAIL on the two-row toolbar, duplicate title, visible helper, and Page
actions.

- [ ] **Step 4: Implement the minimal visual changes**

Implement the presentation helper exactly as specified. During Editing:

```tsx
{!hideOuterTitleWhileEditing ? (
  <h1 className="page-detail-title">{page.title}</h1>
) : null}
```

Render one toolbar element with the scrollable format region first and
persistence actions second. Give it `role="toolbar"` and the localized block
style label.

Hide the complete Page action group while Editing and set the description to
`className="sr-only"`.

For CodeMirror focus, use one boundary:

```ts
"&.cm-focused": {
  outline: "none",
  borderColor: "var(--mem-accent-indigo-border)",
}
```

- [ ] **Step 5: Run focused tests and inspect both responsive layouts**

Run:

```bash
pnpm vitest run \
  src/components/memory/editor/pageEditorPresentation.test.ts \
  src/components/memory/editor/MarkdownEditorToolbar.test.tsx \
  src/components/memory/PageDetail.CodeMirror.integration.test.tsx
pnpm exec tsc -b
```

Expected: all pass.

- [ ] **Step 6: Commit the visual refinement**

```bash
git add src/components/memory/PageDetail.tsx src/components/memory/PageDetail.CodeMirror.integration.test.tsx src/components/memory/editor src/i18n/resources.ts src/index.css
git commit -m "fix: make page editing feel native to Wenlan"
```

### Task 5: E2E, exact-source, native visual QA, and review

**Files:**
- Create: `e2e/page-editor.spec.ts`
- Modify: `e2e/tauriMock.ts`
- Modify: `e2e/runtime.ts`
- Modify: `e2e/types.ts`
- Modify: `preview/mocks/live-invoke.ts`
- No committed screenshot or temporary report files

**Interfaces:**
- Consumes: the integrated implementation from Tasks 1 through 4.
- Produces: executable proof and a native app ready for human review.

- [ ] **Step 1: Restore and run Page editor E2E**

Keep the current split mock architecture and add only editor commands and Page
fixtures. Include a regression that scrolls `main.memory-main-content` before
entering Editing.

Run:

```bash
pnpm exec playwright test e2e/page-editor.spec.ts
```

Expected: every Page editor scenario passes.

- [ ] **Step 2: Run full frontend and Rust gates**

```bash
pnpm test
pnpm test:i18n
pnpm exec tsc -b
pnpm build
pnpm test:e2e
cd app && cargo test
cargo fmt --check --all
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all pass; ignored tests remain explicitly reported.

- [ ] **Step 3: Prove exact source against the stable daemon**

Run an isolated `wenlan-server v0.14.1` with separate data. POST then GET a
fixture containing a BOM, CRLF, leading whitespace, terminal spaces and tabs,
and a final CRLF. Assert byte equality, one version increment for identical
operation replay, and HTTP `409` for changed content with the same operation ID.

- [ ] **Step 4: Launch the native Tauri app and capture fresh evidence**

Clean prior dev processes, start the isolated daemon and native app, open the
published Page, enter Editing, exercise a formatting control and a task
checkbox, scroll the long document, and capture desktop light, desktop dark, and
narrow Editing screenshots outside the repository.

- [ ] **Step 5: Run the two inline visual QA passes**

Pass A checks real component structure, Wenlan token reuse, actions, focus,
responsive behavior, and interactions. Pass B directly inspects every fresh
screenshot for hierarchy, duplicate title, wrapping, clipping, scroll traps, and
CJK precision. Both must return PASS with no blocking findings on the same build.

- [ ] **Step 6: Run independent integrated code review**

Ask a fresh reviewer to inspect the current diff against the approved spec for
correctness, security, concurrency, error handling, resource lifetime, shell
regressions, and spec drift. Every finding must cite a concrete file and line.
Fix all critical and important findings, then rerun affected gates.

- [ ] **Step 7: Leave the native app open for human review**

Report the branch, commits, exact commands and counts, exact-source proof,
screenshot paths, reviewer verdict, and remaining Windows or real-IME gates.
Do not push or merge.
