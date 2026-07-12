# Onboarding + Settings — screenshot tour & design critique

**Branch:** `redesign-onboarding-settings` · **Date:** 2026-07-12
**Surfaces walked:** 6 wizard steps + 6 settings sections (5 reachable, 1 orphaned)

## How these pixels were obtained

The Tauri debug window will not paint its web-content layer on this machine after a
display sleep (AppKit still draws the traffic lights; the WKWebView stays blank). Proven
not to be a branch regression: detaching to merge-base `907b210` is *identically* blank,
and Chrome renders the same dev bundle perfectly.

So the walk ran through the repo's own preview harness
(`pnpm exec vite --config vite.preview.config.ts`, port 1421) whose root path proxies the
**live daemon** — the agent list below is real user data. Screenshots via headless Chrome,
which never touches the desktop or steals focus.

Getting there required one real fix (committed, `b0cba77`): the harness's app-local stubs
returned `null` where the Rust commands return structs, which **white-screened the whole
connect step** (`RemoteAccessPanel` reads `status.status`; its `= { status: "off" }`
useQuery default only covers `undefined`, so `null` sails past it).

---

## Tier 1 — the UI is saying things that are not true

### 1. Raw agent IDs still ship — and this contradicts my own commit

Commit `ecd009f` claims "no raw agent ids". They are still there, in two places
(Settings → Agents, and the wizard's verify step):

| Rendered title | Reality |
| --- | --- |
| `Claude Code`, `Codex`, `ChatGPT`, `Cursor`, `Claude Desktop` | resolved name + slug as subtitle |
| `codex-ulw-loop`, `codex-mcp-client`, `cursor-vscode` | **raw slug used as the title**, no subtitle |

`resolveAgentDisplayName` (`src/lib/agents.ts`) maps known IDs and passes unknown ones
through untouched. Half the list is human names, half is machine IDs, and the rows are
different heights because only the named ones carry a subtitle. This is the single most
visible "unfinished" tell in the product.

### 2. The privacy footer is false, on every settings section

> "Everything stays on your device. No data leaves your machine — no cloud sync, no API
> calls, no telemetry."

It renders directly beneath the **Anthropic API key input** on the Intelligence section —
a screen whose entire purpose is to send page content to a cloud API, and whose wizard
step marks that path "Recommended". Rewrite is drafted and **awaiting your sign-off**
(trust-surface copy; I won't ship a privacy claim you haven't read).

### 3. "Install the Wenlan plugin" — violates the standing copy rule

Standing rule: *never announce that something is a plugin.* Live on the Claude Code card
(connect step) and the claude.ai card. The Codex card sitting immediately beside it
already does it correctly — **"Add Wenlan to Codex from your terminal"** — so the fix is
to make Claude Code match its neighbour.

---

## Tier 2 — "messy and inconsistent", specifically

This is the complaint made concrete. Each is a rule that exists but is applied unevenly.

1. **Status chips speak two languages.** Mono/UPPERCASE (`CONFIGURED`, `NOT LOADED`,
   `NOT CONFIGURED`, `BASIC MEMORY — NO MODEL CONFIGURED`) vs sans/Sentence-case
   (`Detected`, `Recommended`, `Screen Recording granted`). They collide **on the same
   card**: the Cursor row shows `Detected` (sans) next to `CONFIGURED` (mono caps).
2. **Native `<select>` in a token-styled UI.** Language (General), trust level (Agents),
   model picker (Intelligence) are raw OS controls — the only unstyled widgets in the app.
3. **Card titles use three faces at one hierarchy level.** Serif (`Claude.ai`,
   `Chat history`), bold sans (`Your own local server`), regular sans (`Anthropic API Key`,
   `On-Device Model`, `Share with web-based AI tools`).
4. **Section labels use three styles.** Sans-caps-tracked in the wizard
   (`DETECTED ON YOUR MAC`), serif sentence-case on the import step
   (`Obsidian vault / notes folder`), mono-caps + icon in settings (`PROFILE`, `APP`) —
   and Diagnostics' `PIPELINE SNAPSHOT` is missing the icon its siblings have.
5. **Card grouping is arbitrary.** General gives each toggle its own card; Capture puts
   two identical toggles in one divided card.
6. **Two competing primary buttons per screen.** "Import chat history" competes with
   "Continue"; "Choose file" competes with "Add your first source".

## Tier 3 — UX gaps from the original list

- **Thread #4 is half-done.** Commands no longer truncate (fixed), but there is still **no
  per-command copy button** — only a single "Copy setup prompt" per card.
- **"Or write the config for me"** is the escape hatch, rendered as muted caption text with
  no button affordance. It reads as a label, not a control.
- **"Import Memories" card has no affordance at all** — title, description, no button.
- **The default contradicts the recommendation.** On the intelligence step, *On-device
  model* is pre-selected while *Anthropic API key* wears the "Recommended" badge.
- **The wizard ends twice.** `verify` ("You're all set." → Get started) and `done`
  ("Wenlan is ready." → Open Wenlan) are two consecutive congratulation screens that
  repeat one sentence verbatim.
- **~500 px of dead space** on welcome / verify / done: content hugs the top, action bar is
  pinned to the bottom, nothing optically centred.
- **`CONNECTED TO OLLAMA — 0 MODELS`** — a success-tone chip for an endpoint that cannot
  serve. The chip is *honest* (it reflects a real probe of the live endpoint — the
  invariant holds), but the tone claims success. Thread #3's pluralisation is still unfixed.
- **Copy is still memory-first**, not wiki-pages-first: welcome reads "Wenlan. Where
  understanding compounds."; done reads "Memories will appear in Wenlan as agents save
  what they learn."

## Confirmed fixed (verified in pixels, not tests)

- **Thread #6 — Codex.** Codex CLI now gets the full CLI-primary path with a real
  `codex mcp add wenlan -- npx -y wenlan-mcp` command and a Copy setup prompt button, not
  just an MCP one-liner.
- **Clipped action bar.** The fixed 64 px action bar means Back/Skip/Continue are visible
  on every step by construction.
- **Command truncation.** Commands render full-width, untruncated.

## Not my regression (pre-existing at merge-base `907b210`)

- **`CaptureSection` is orphaned dead UI.** The clipboard and screen-capture toggles are
  rendered by `SettingsPage` but `id: "capture"` is commented out of `SETTINGS_GROUPS`
  (`SettingsSidebar.tsx:112`), so the sidebar can never navigate there. Reachable only by
  forcing the route.

---

## Recommended order of attack

1. Raw agent IDs (Tier 1.1) — falsifies a shipped commit message.
2. "Plugin" copy (Tier 1.3) — standing rule, one-line fix, neighbour already correct.
3. Privacy footer (Tier 1.2) — **blocked on your sign-off.**
4. One chip vocabulary + kill the native `<select>`s (Tier 2.1, 2.2) — the bulk of the
   "inconsistent" feeling.
5. Card-title and section-label typography (Tier 2.3, 2.4).
6. Per-command copy buttons, affordance fixes, merge the two ending screens.
