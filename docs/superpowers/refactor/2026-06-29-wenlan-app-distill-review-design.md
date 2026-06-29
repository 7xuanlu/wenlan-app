# Wenlan App Distill Review Panel Design

- **Date:** 2026-06-29
- **Worktree:** `/Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-api-parity-audit`
- **Branch:** `codex/wenlan-app-distill-design`
- **Decision:** implement the review-first distill surface before any page rebuild action.

## Goal

Close the desktop app parity gap for the safe part of `/api/distill` by adding a
non-destructive Distill Review panel. The panel lets the user inspect daemon
distillation work that needs attention without rewriting pages or clearing
user-edited content.

This is the first distill checkpoint. It deliberately does not expose force
rebuild or `POST /api/distill/{page_id}`.

## Evidence

Current route diff:

```text
backend routes: 123
app source routes: 112
missing in app: 11
app-only routes: 0
```

The relevant missing routes are:

- `/api/distill`
- `/api/distill/{page_id}`

Backend behavior:

- `POST /api/distill` accepts `target?: string` and `force?: bool`.
- Normal `POST /api/distill` never invokes the daemon LLM for synthesis. It
  returns review data: `pending`, `stale_pages`, `stale_truncated`, and
  `orphan_topics`.
- `force=true` clears `user_edited` on a resolved page before recompile.
- `POST /api/distill/{page_id}` also clears `user_edited` before re-distilling.

App behavior:

- `PageDetail` already shows page state, source memory evidence, links,
  unlinked mentions, and revision history.
- The app has established Rust client, Tauri command, and TypeScript wrapper
  seams for page-related routes.
- There is no callable distill wrapper or visible manual distill review surface.

## User Experience

Add a Distill Review entry point on Home near the existing `RefiningList`
section, then open a dedicated `Main` view such as
`{ kind: "distill-review" }`. This keeps the review queue in the same place as
other memory refinement work while avoiding extra weight in `PageDetail`.

The first version should be work-focused and quiet:

- A refresh action runs the normal `/api/distill` review pass.
- The panel renders three sections:
  - **Pending pages:** clusters not fully covered by an existing page.
  - **Stale pages:** pages with updated sources that may need attention.
  - **Unlinked topics:** repeated orphan page-link labels from the daemon.
- Empty sections stay collapsed or show a compact empty state.
- Rows are navigational or informational only:
  - Pending clusters show title-like cluster label, source count, existing page
    hint when present, and new-memory count when present.
  - Stale pages link to existing Page Detail.
  - Unlinked topics show label and mention count.
- No row performs page rewrite, synthesis, force rebuild, or page deletion.

The copy should avoid promising that the app can synthesize a page in this
checkpoint. The panel is a review queue, not an editor.

## Data Contract

Add app-local strict response types because `wenlan-types 0.9.2` does not expose
a stable typed distill response for this route yet.

Minimum TypeScript/Rust shape:

```text
DistillReviewRequest {
  target?: string | null
}

DistillReviewResponse {
  pages_created: number
  scoped: boolean
  created_ids: string[]
  pending: DistillPendingCluster[]
  stale_pages: DistillStalePage[]
  stale_truncated: boolean
  orphan_topics: DistillOrphanTopic[]
  unresolved?: string | null
  hint?: string | null
}

DistillStalePage {
  page_id: string
  title: string
  summary?: string | null
  source_memory_ids: string[]
  sources_updated_count?: number | null
  stale_reason?: string | null
  user_edited?: boolean | null
}

DistillOrphanTopic {
  label: string
  count: number
}
```

`DistillPendingCluster` should accept the daemon's current cluster fields plus:

- `existing_page_id?: string | null`
- `existing_page_title?: string | null`
- `new_memory_count?: number | null`

The implementation should preserve strict envelopes at the command boundary:
daemon shape drift should fail tests rather than silently rendering nonsense.

## Architecture

Use the existing app seam pattern:

1. `app/src/api.rs`
   - Add `WenlanClient::distill_review(target: Option<&str>)`.
   - Use `POST /api/distill` with JSON body.
   - Do not send `force`.

2. `app/src/search.rs`
   - Add a `#[tauri::command] distill_review`.
   - Clone `WenlanClient` out of app state before awaiting.
   - Return the typed response directly.

3. `app/src/lib.rs`
   - Register the new command.

4. `src/lib/tauri.ts`
   - Add request/response interfaces and `distillReview(target?: string)`.

5. Frontend component
   - Add `src/components/memory/DistillReviewPanel.tsx` as a dedicated routed
     view in `Main.tsx`.
   - Add a compact Home entry point near `RefiningList`.
   - Use React Query for loading, refresh, error, and retry states.
   - Navigate stale pages into existing `PageDetail` instead of introducing a
     rebuild action.

## Error Handling

- If the daemon returns `unresolved`/`hint`, show the hint as a compact
  non-blocking notice.
- If a refresh fails after a previous success, keep the last successful results
  visible and show a retryable error banner.
- If `stale_truncated` is true, show a small note that more stale pages may
  exist and another pass may be needed.
- Older daemon incompatibility should surface as a clear route/shape error, not
  as an empty queue.

## Testing

Use TDD before implementation.

Required RED tests before code:

- Rust API client posts to `/api/distill` and does not include `force`.
- Rust response type deserializes a daemon-shaped payload containing pending,
  stale pages, orphan topics, and `stale_truncated`.
- Tauri command returns the typed response without holding a state guard across
  await.
- TypeScript wrapper invokes `distill_review` with `{ target: null }` by default.
- Frontend renders the three sections, empty states, unresolved hint, truncated
  note, and stale-page navigation.

Required verification after implementation:

- `pnpm test`
- `cargo test --manifest-path app/Cargo.toml`
- `pnpm build`
- `cargo clippy --manifest-path app/Cargo.toml --all-targets -- -D warnings`
- `pnpm refactor:api-routes --json`

Expected route diff after this checkpoint:

```text
backend routes: 123
app source routes: 113
missing in app: 10
app-only routes: 0
```

## Tool Boundary

- Use CodeGraph to locate impact surfaces before implementation:
  - `codegraph sync .`
  - `codegraph query WenlanClient --json`
  - `codegraph query PageDetail --json`
- Use local ast-grep (`sg`) for structural checks in Rust and TypeScript.
- Use `rust-analyzer` and Cargo tests as semantic validation.
- Use `rg` as the fallback when CodeGraph or ast-grep cannot express the query.

## Explicit Non-Goals

- No `force=true` UI.
- No `POST /api/distill/{page_id}` wrapper or button in this slice.
- No page synthesis editor.
- No relation/entity graph authoring.
- No WebSocket migration.
- No operator route panel for `/api/debug/pipeline`, `/api/steep`, or
  `/api/context`.

## Boule Review Questions

Run `/boule:debate` on this design before implementation planning. Review should
focus on:

- Whether the panel accidentally implies that the app can synthesize or rebuild
  pages in this slice.
- Whether any UI action can clear `user_edited` content without explicit future
  confirmation.
- Whether the app-local response types are strict enough to catch daemon route
  drift.
- Whether the dedicated Home-to-review view is better than embedding the review
  list into Page Detail.
- Whether pending clusters need a richer source-memory preview before they are
  useful.

## Approval State

Approved by user on 2026-06-29 with direction `1`: review panel first.
