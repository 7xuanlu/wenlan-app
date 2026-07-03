# Page detail redesign: per-claim citations + reading-page structure

- **Date:** 2026-07-03
- **Status:** approved layout (option A "reading page"); spec pending user review
- **Visual reference:** design-review artifact (option A mockup with annotations); original inspiration mockup provided by user
- **Backend dependency:** `7xuanlu/wenlan` PR #332 "feat: per-claim verified citations for wiki pages" (commit `2f6ee4bd`, merged 2026-07-03, **unreleased** — on `origin/main` only)

## Goal

Turn the wiki page-detail view into a citation-first reading page: every claim in the
body carries an inline source chip with a hover popover, and everything that is not
reading (sources index, backlinks, revision history) folds into a single collapsed
disclosure. Resolves all findings from the 2026-07-03 UI audit of `PageDetail.tsx`.

## Non-goals

- Toolbar redesign (icon-only buttons, native `confirm()` delete stay as-is).
- Edit-mode markdown preview.
- A new home for Unlinked Mentions (deleted from this view; future maintenance
  surface is a separate effort).
- Shell / typography changes outside the page view.
- TLDR pull-quote heuristic rework.

## Context: what the backend now provides (PR #332)

- `Page.citations: PageCitation[]` where `PageCitation = { occurrence: u32, marker: u32,
  source_kind: "memory" | "external_url" | "external_file" | "authored", locator: string,
  score: f64, status: "verified" | "unverified", scope: "sentence" | "paragraph" }`.
  `occurrence` is the k-th `[N]` instance in body order; `marker` is the N.
- Page body markdown carries literal `[N]` markers appended after cited sentences;
  multi-source claims render as `[1][3]`.
- `PageChangelogEntry` gained `citations_summary: Option<String>`
  (e.g. `"3 verified, 1 unverified, 2 stripped"`).
- No new endpoints. Citation resolution for popovers goes through the existing
  `GET /api/pages/{id}/sources` (`PageSourceWithMemory[]`).

## Blocker found and designed around

`app/Cargo.toml:83` pins `wenlan-types = "0.9.2"` (semver-capped to 0.9.x), and the
Tauri commands deserialize daemon responses into that crate's structs
(`get_page`, `app/src/search.rs:2941`, via `GetPageWire { page: Option<Page> }`).
Serde silently drops unknown fields, so the daemon's new `citations` array would
never reach the frontend — even with a new daemon binary.

**Decision: raw-JSON passthrough.** `get_page` and `get_page_revisions` return
`serde_json::Value` instead of typed structs. The Rust layer does not consume
`Page`/revision fields on these paths; TypeScript types the response. This removes
the silent-field-drop bug class for these endpoints permanently and does not block
on a crates.io publish of a newer `wenlan-types`. Other page endpoints stay typed
(their shapes are unchanged by PR #332).

## Design

### 1. Data layer

- **Rust** (`app/src/search.rs`): `get_page` and `get_page_revisions` switch to
  `serde_json::Value` passthrough. 404 handling for `get_page` (distinguishing
  "not found" from real errors) is preserved.
- **TS** (`src/lib/tauri.ts`): add `PageCitation` interface mirroring the wire type;
  `citations?: PageCitation[]` on `Page`; `citations_summary?: string` on
  `PageChangelogEntry`.
- **Queries:** no new react-query queries. Popovers resolve against the existing
  `["page-sources", pageId]` data. The global `["orphan-page-links", 2]` query and
  the `listOrphanLinks` call are deleted from `PageDetail.tsx`.

### 2. Citation rendering pipeline

- Marker mapping runs against the **original** `page.content` (the backend's
  `occurrence` indexing is defined on body order of the raw content), *before* the
  existing title-heading and `## Sources` stripping.
- The k-th `[N]` instance is rewritten to a markdown link `[<locator>](#citation:k)` —
  the same preprocessing idiom `[[wikilinks]]` already use (`PageDetail.tsx:320-329`).
- `ContentRenderer`'s existing `a` component override detects the `#citation:` href
  and renders `CitationChip` inline: mono pill showing the locator plus a superscript
  occurrence number. Long locators (URLs, paths) truncate to domain / basename.
- Markers inside fenced code blocks are left literal (the preprocessor skips fenced
  regions).
- A marker with no matching `citations` entry is stripped from display.
- `citations` empty or absent → content passes through untouched (old pages carry no
  markers; the daemon strips markers when citations are not retained).

### 3. Popover (`CitationPopover`)

- Opens on hover (~150 ms delay) and keyboard focus. Chip click opens the source.
  On touch, first tap opens the popover, action buttons navigate.
- Content by `source_kind`:
  - `memory`: source title, "Source memory" kind badge, locator + date line,
    ~200-char snippet, "Open memory →" action — navigates via the existing
    `onMemoryClick` path (the currently-dead `#memory:` anchor wiring at
    `PageDetail.tsx:350-354` becomes live).
  - `external_url`: domain badge, locator, "Open in browser" (Tauri shell open).
  - `external_file`: path shown, no snippet, no action.
  - `authored`: "written directly" note, no action.
- `status: "unverified"` → chip renders dashed and muted; popover carries an explicit
  "unverified" line. Unverified citations are **never hidden** — hiding them would
  misrepresent the page's trustworthiness.
- Locator that does not resolve in page-sources data → popover shows the locator and
  "source not available".
- Popover data still loading → chip renders normally; popover shows a skeleton.

### 4. Page structure (top → bottom)

1. Header (back, serif title, meta line) — unchanged.
2. Actions toolbar — unchanged.
3. TLDR pull-quote — unchanged.
4. Body with citation chips.
5. **Related pages**: outbound links (`get_page_links.outbound`) as cards; resolved
   targets clickable, unresolved targets muted and inert (no more dead links styled
   as buttons). Hidden when there are zero outbound links — an empty header here is
   noise, not information.
6. **Page info** disclosure — **always rendered**, collapsed by default, summary line
   with counts ("6 sources · 2 backlinks · 4 revisions"; zero counts are informative
   and replace today's vanishing sections). Expanded groups:
   - **Sources**: compact rows (locator chip, title, date), ordered by first citation
     occurrence, then uncited by recency; unverified tags where applicable. Replaces
     the current full-width Source Memories list.
   - **Backlinks**: inbound links shown by label — raw page-ID strings removed.
   - **Revisions**: existing changelog rows plus a `citations_summary` chip.
7. **Unlinked Mentions: deleted** from this view (today it renders a global list —
   identical on every page, `PageDetail.tsx:361` — under a page-scoped heading).

**Component layout:** new subcomponents in `src/components/memory/page/`:
`CitationChip.tsx`, `CitationPopover.tsx`, `RelatedPages.tsx`, `PageInfo.tsx`.
`PageDetail.tsx` remains the orchestrator (queries, mutations, edit mode) and sheds
roughly 300 lines. `EvidenceCard` is absorbed into `PageInfo`'s source rows.

### 5. Fallback & errors

- Old daemon (response lacks `citations`): no chips; related pages and Page info
  work unchanged. Silent graceful degrade — no version banner on the read path.
  Re-distilling on a new daemon populates citations.
- `get_page` failure modes unchanged (404 → "Page not found" state, real errors
  surface).

### 6. Testing

- **Vitest + Testing Library:**
  - Marker-mapping util: occurrence ordering, `[1][3]` runs, code-fence skip,
    unmatched-marker strip, empty-citations passthrough.
  - `CitationChip` / `CitationPopover`: verified / unverified / unresolved states,
    each `source_kind` variant.
  - `PageDetail` integration: chips render from a fixture page with citations;
    Page info disclosure toggles; orphan-links query no longer issued;
    empty-citations fallback renders old layout without chips.
- **Manual:** `git -C ../wenlan pull` (PR #332 is on `origin/main`), `pnpm dev:all`,
  verify chips + popovers on a re-distilled page. No e2e harness exists in this repo —
  known limitation.
- **CI:** `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `tsc -b`, `pnpm test`
  all must pass (enforced by `ci.yml`).

## Dependencies and release gate

- **Dev:** sibling `../wenlan` checkout must be at `origin/main` (≥ commit `2f6ee4bd`)
  for the daemon sidecar to serve citations.
- **Release:** `release.yml` resolves the backend at its **latest GitHub release
  tag**. Shipping this feature requires the backend to tag a release containing
  PR #332 first. Until then the app degrades gracefully (no chips).

## Implementation-time verifications

- Confirm `PageCitation.locator` values match `PageSource.memory_source_id`
  namespace for `source_kind: "memory"` (spec assumes they match; the
  "source not available" popover fallback covers a mismatch).
- Confirm the daemon's `## Sources` markdown section never contains `[N]` markers
  (occurrence mapping runs before stripping, so this is belt-and-braces).

## Alternatives considered

- **B — content + inspector rail** (two-column, provenance always visible): rejected —
  diverges from the reference mockup, largest layout diff, needs a narrow-window
  collapse breakpoint. Can be layered on later if reading mode proves insufficient.
- **C — citations only, sections untouched**: rejected — ships every audit finding
  unfixed (global Unlinked Mentions, raw UUIDs, four look-alike always-open sections).
- **Bumping `wenlan-types`** instead of JSON passthrough: rejected — blocks on an
  unreleased crate publish and re-couples the app to backend release cadence;
  passthrough removes the silent-drop bug class entirely for these endpoints.

## Audit findings → resolution map

| Audit finding | Resolution |
|---|---|
| Unlinked Mentions shows a global list under a page-scoped heading | Section deleted; global query removed |
| Inbound links expose raw page IDs | Backlinks show labels only |
| Unresolved outbound links styled identically to clickable ones | Muted + inert in Related pages |
| Sources decoupled from the claims they support | Inline chips + popovers |
| Three visually identical always-open sections | One collapsed Page info disclosure |
| Dead `#memory:` anchor wiring | Becomes the popover's "Open memory" path |
| No empty states (sections vanish) | Page info always renders with zero-count summaries; Related pages hides only when genuinely empty |
