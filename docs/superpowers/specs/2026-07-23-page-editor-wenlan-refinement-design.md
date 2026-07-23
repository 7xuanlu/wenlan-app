# Wenlan Page editor integration and visual refinement

- **Date:** 2026-07-23
- **Status:** approved for implementation
- **Base:** current `origin/main` at `c4d6d3d`
- **Primary surface:** published Page detail in the native Wenlan desktop app
- **Editor engine:** direct CodeMirror 6 behind the Wenlan-owned adapter
- **Storage contract:** exact Markdown source with stable daemon floor `v0.14.1`

## Product decision

Editing is a state of a Wenlan Page, not a separate Markdown tool. The user sees
normal rendered formatting while writing. Markdown punctuation appears only where
the cursor or selection makes it useful. Reading remains the existing
`ContentRenderer`; Editing remains CodeMirror over the canonical source string.
There is no user-facing "Markdown mode", "Source mode", or "Live Preview mode".

The editor must preserve the current Page shell from `origin/main`, including the
current Home, Wiki, Spaces, published Page actions, attached-page notice,
citations, links, revisions, PageDraft behavior, localization, and navigation.

## Visual direction

This is a preserve-mode refinement of Wenlan's existing quiet editorial Page:

- Design variance `4`
- Motion intensity `2`
- Visual density `5`
- Existing Wenlan typography, colors, spacing tokens, radii, and Phosphor icons
- No new design system, accent color, card, modal, animation, or editor mode switch

### Reading

Reading is unchanged. The Page header shows title, dateline, and normal actions.
The existing renderer owns the body.

### Editing

1. The Page header remains the context for the document.
2. If the exact source begins with an H1 whose normalized visible text equals the
   Page title, the outer Page title is visually omitted during Editing. The
   editable H1 becomes the single visible title. If no matching leading H1 exists,
   the outer Page title remains visible.
3. Page-level copy, export, re-distill, delete, and overflow controls are absent
   from the Editing DOM. The editor toolbar is the only action center.
4. The toolbar is one compact sticky row:
   - formatting groups on the left;
   - Save and Cancel on the right;
   - formatting buttons use Phosphor icons with localized `title` and
     `aria-label` tooltips;
   - the block-style select remains textual because it represents a choice, not
     one action;
   - on narrow widths the formatting side scrolls horizontally while persistence
     actions remain reachable.
5. The long instructional sentence is not persistently visible. A concise,
   localized description remains screen-reader accessible through
   `aria-describedby`; button tooltips and familiar shortcuts provide visible
   discoverability.
6. The editable surface has one 1px Wenlan boundary. Focus changes that boundary
   color without adding an outer double ring.
7. The document viewport and Page shell continue to scroll before Editing and
   during long Editing sessions. No nested scroll trap may prevent reaching the
   lower Page content.

## Duplicate-title normalization

The comparison is presentation-only and never rewrites source.

`leadingMarkdownH1MatchesTitle(source, title)`:

1. accepts an optional UTF-8 BOM and leading blank lines;
2. recognizes only an ATX level-1 heading (`# Title`), not `##`, setext, or a
   heading later in the document;
3. removes an optional closing ATX hash run;
4. trims and collapses Unicode whitespace in both values;
5. compares case-sensitively;
6. returns `false` for an empty normalized heading or title.

This intentionally avoids Markdown parsing or serialization. A title containing
inline formatting does not match a plain Page title unless its visible source text
is already identical after whitespace normalization.

## Behavioral contracts that must not regress

- Source preparation is BOM-free logical LF in the editor.
- Save restores the original BOM and uniform LF or CRLF profile, terminal
  whitespace, and final newline.
- Mixed or lone-CR input requires explicit normalization before Editing.
- Empty validation may inspect `trim()` but persistence receives untrimmed source.
- Every save uses `expected_version`, `caller_id = "wenlan-app"`, and one
  operation ID per content snapshot.
- Conflict, upgrade, transport, auth, validation, payload, rate-limit, server,
  and other failures keep the draft recoverable.
- Only one save is pending. Pending save blocks destructive navigation.
- Dirty Back, Cancel, Escape, search replacement, and cross-view navigation share
  the existing confirmation policy.
- IME composition blocks formatting, Save, Cancel, and Escape until composition
  settles.
- CodeMirror load or construction failure uses the native exact-source fallback
  and emits only a content-free local diagnostic.
- Read mode never loads CodeMirror and still uses `ContentRenderer`.
- Task checkboxes remain keyboard operable and retain focus after their widget
  rerenders.

## Dependency and daemon floor

Direct dependencies are exact-pinned:

- `@codemirror/commands` `6.10.4`
- `@codemirror/lang-markdown` `6.5.1`
- `@codemirror/language` `6.12.4`
- `@codemirror/state` `6.7.1`
- `@codemirror/view` `6.43.6`
- `@lezer/highlight` `1.2.3`
- `@phosphor-icons/react` `2.1.10`

No React editor wrapper, `codemirror` convenience bundle, AST serializer,
community CodeMirror extension, or second preview renderer is allowed.

The app, Tauri crate, Tauri config, lockfile, `wenlan-types`, and sidecar pin align
at `0.14.1`. The macOS arm64 sidecar SHA-256 remains
`667e5cadafece24d520e098b1359e38d94adada8dbcf45913b836c925aa4c87e`.

## Acceptance tests

### Focused component tests

- toolbar formatting and persistence groups share one toolbar row;
- Save and Cancel remain reachable when formatting overflows;
- no visible persistent helper paragraph;
- matching leading H1 hides only the outer title during Editing;
- mismatched or absent leading H1 keeps the outer title;
- Page header actions are absent during Editing and return after Cancel;
- focus styling is one boundary and checkbox focus survives rerender.

### Integration and E2E

- contextual syntax reveal and visual bold, italic, code, lists, tasks,
  blockquotes, headings, links, images, callouts, and horizontal rules;
- exact CAS save and refetch;
- conflict, upgrade, failure, fallback, dirty navigation, and empty validation;
- long Page scroll before Editing and long editor scroll after entry;
- desktop and narrow widths in light and dark themes;
- no source/live-preview toggle is present.

### Full gates

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

Final proof must include a fresh native Tauri screenshot and interaction pass
against the published `v0.14.1` daemon, plus the isolated exact-source POST to GET
round trip. Windows WebView2 and a real IME candidate-window session remain
explicit release-readiness gates if no runner is available.
