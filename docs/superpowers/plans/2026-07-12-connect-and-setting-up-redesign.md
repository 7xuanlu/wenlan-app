# Wizard redesign: Connect selects, "Setting up" does the work

**Date:** 2026-07-12
**Branch:** `redesign-onboarding-settings`
**Status:** design, ready to implement

## The problem

Today the Connect step both *asks* and *acts*. It makes the user pick tools, then
writes their MCP configs inline on "Continue", and for Claude Code it doesn't act at
all — it prints three slash commands and asks the user to go type them somewhere else.
Dot 5 (Verify) then sits and waits for proof, and for anyone who has ever used Wenlan
it auto-advances instantly, so it may as well not exist.

The result is a wizard where the work is scattered across the steps that asked for it,
and the one step that could show progress shows nothing.

## The shape

**Dot 4 — Connect: selection only.** Checkboxes, nothing else. No config writes, no
copy-a-snippet, no "go type this in your terminal". Every detected client gets a
checkbox, *including* already-configured ones — which start checked but stay
**unselectable-able**, so a user can opt out of a tool Wenlan already touched.

**Dot 5 — Setting up: all the work, visibly.** One task list, one row per unit of work,
each row live. This is the only place in the wizard that mutates anything outside
Wenlan, and the only place the user watches it happen. It ends by absorbing Verify's
job: waiting for a real agent write.

**Dot 6 — Done.** Unchanged. Still 6 dots.

## Dot 5 in detail

Rows are built at entry from wizard state, in this order:

| Row | Source | Done when |
| --- | --- | --- |
| One per selected MCP client | `selectedClients` from dot 4 | `writeMcpConfig(client_type)` resolves |
| Claude Code plugin | Claude Code detected **and** selected | plugin install IPC resolves |
| Waiting for your first agent | always | an agent has written since `wizardEnteredAt` |

Rules that make this honest rather than decorative:

- **A failed row does not block the wizard.** It shows its error and stays failed;
  Continue remains live. A user must never be trapped in setup because one editor's
  config was read-only.
- **The final row is the only one that proves anything.** Writing a config file proves
  we wrote a file. Only an agent write proves the connection works. Keep that
  distinction in the copy — a configured row says *configured*, not *connected*.
- **The waiting row never auto-advances the wizard.** It resolves its own row and stops
  there. (Today `VerifyStep` calls `onNext()` from inside an effect the moment it sees
  any past agent write — `SetupWizard.tsx:930` — which is why returning users never see
  dot 5. That behaviour dies with the step.)

## Claude Code: install the plugin, don't hand-write JSON

The user's call: Claude Code auto-configures like everything else, and it gets the
**plugin** (which registers the MCP server itself), not a bare MCP entry.

The `claude` CLI exposes both halves non-interactively — verified 2026-07-12 against
`claude` 2.1.206:

```
claude plugin marketplace add <source>      # --scope user (default)
claude plugin install <plugin>@<marketplace>  # --scope user (default)
```

So: `claude plugin marketplace add 7xuanlu/wenlan`, then
`claude plugin install wenlan@7xuanlu-wenlan`. Shelling out to a vendor's supported CLI
beats replicating its private install state — `~/.claude/plugins/installed_plugins.json`
is versioned, undocumented, and carries a git cache with commit SHAs; the `.bak-*` files
next to it show the format churns.

Verified 2026-07-12 against `claude` 2.1.206, in a throwaway `$HOME`:
`marketplace add 7xuanlu/wenlan` yields a marketplace named `7xuanlu-wenlan`, and
`install wenlan@7xuanlu-wenlan` installs at user scope.

Two things the implementation must get right — and they apply to **both** CLIs:

- **Resolve the binary via a login shell first.** A Tauri app launched from Finder inherits
  PATH=`/usr/bin:/bin:/usr/sbin:/sbin` and will find neither CLI. On this machine `claude`
  is `~/.local/bin/claude` and `codex` is `~/.nvm/versions/node/v24.11.1/bin/codex` — an
  **nvm** path, version-specific and unguessable, which no static probe list can find. So:
  try `zsh -lic 'command -v <bin>'` first, then fall back to static probes
  (`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`). Not found →
  the row fails with "CLI not found", which is a true statement, and the wizard moves on.
  Never set `CODEX_HOME`; codex errors hard if it points at a missing dir.
- **Be idempotent.** Re-adding an existing marketplace or re-installing an installed plugin
  exits 0 on both CLIs ("already installed" / "already added"). Classify those as success —
  most users hitting this path already have one or both.

**Never write `~/.claude.json` for `claude_code`.** The plugin registers the MCP server;
writing it again duplicates it. `mcp_config.rs` still supports that path — leave it, but
the wizard must not call it. This invariant already exists in the code
(`SetupWizard.tsx:561-566`) and survives the redesign.

## Codex + ChatGPT desktop: one row, one plugin, both named

Codex has the same plugin mechanism as Claude Code, and **Wenlan already ships a Codex
plugin** — `7xuanlu/wenlan` → `plugin-codex/.codex-plugin/plugin.json`, which declares
`"mcpServers": "./.mcp.json"`. So the MCP server ships *with* the plugin, exactly as it
does for Claude. Both clients get the same treatment.

Verified 2026-07-12 against `codex-cli` 0.144.0, in a throwaway `$HOME`:

```
codex plugin marketplace add 7xuanlu/wenlan   # → marketplace named `wenlan-local`
codex plugin add wenlan@wenlan-local          # note: `add`, not `install`
```

Both idempotent, exit 0 on repeat. The install writes
`[plugins."wenlan@wenlan-local"]\nenabled = true` into `~/.codex/config.toml`.
**Do not also write `[mcp_servers.wenlan]`** — the plugin carries it. Same invariant as
Claude Code: plugin, not raw MCP entry.

`~/.codex/config.toml` is shared by Codex CLI, the Codex IDE extension, **and** the Codex
pane inside ChatGPT desktop (OpenAI merged Codex into the ChatGPT app on 2026-07-09;
`learn.chatgpt.com/docs/extend/mcp` — they "share MCP configuration for the same Codex
host"). Locally corroborated: `/Applications/ChatGPT.app` declares the URL scheme `codex`,
and the user's `~/.codex/config.toml` carries an `[mcp_servers.node_repl]` entry whose
command points into `ChatGPT.app/Contents/Resources/cua_node/`.

So:

- **One row, not two.** One file, one plugin. A second checkbox writing the same config
  would be a lie in the UI.
- **The row names both**, so the user can see one action covers both — e.g.
  *"Codex CLI & ChatGPT desktop"*, with a sub-line stating it covers ChatGPT desktop's
  **Codex** pane.
- **Detect either.** `detect_mcp_clients()` finds `codex_cli` only by the existence of
  `~/.codex/config.toml` (default branch, `mcp_config.rs` ~line 130). Add a bundle check
  for `/Applications/ChatGPT.app` (mirror the Cursor branch ~line 133) so the row also
  appears for a ChatGPT-desktop user who has never run Codex CLI.

**What the row must not claim.** ChatGPT's general chat/Work assistant supports *remote*
MCP over public HTTPS only — no stdio, no local file. Adding one needs Developer Mode, a
Plus/Pro/Business account, and a hand-entered public URL in ChatGPT's own settings: the
relay path the user has parked. The row covers the Codex surface, and must not read as
"ChatGPT connected".

### The marketplace name is being renamed — do not hardcode it

The Codex marketplace was published as `wenlan-local` ("local" is the plugin *source type*
in the manifest, which leaked into the public name). Fixed upstream in
[7xuanlu/wenlan#348](https://github.com/7xuanlu/wenlan/pull/348): it becomes
**`7xuanlu-wenlan`**, which is exactly what Claude Code derives from the same repo slug —
so the selector is `wenlan@7xuanlu-wenlan` on *both* CLIs. That PR also ships the Wenlan
mark (`interface.logo` / `logoDark` / `composerIcon`), which Codex renders and we had
never provided.

`codex plugin marketplace add 7xuanlu/wenlan` clones the repo's **default branch**, so the
name the app must use flips the moment that PR merges. The app therefore **resolves the
selector at runtime** — `plugin marketplace add`, then read the `wenlan@…` row out of
`plugin list` — with a per-client hardcoded default only as a fallback. That makes the
installer correct on both sides of the rename, and immune to the next one.

## Claude Desktop: two surfaces, and only one of them is ours

Claude Desktop has a **Code side** and a **Chat side**, and they share nothing.

- **Code side** = `~/.claude/plugins/`, the same store the `claude` CLI writes. So
  `claude plugin install` already covers it — no extra work.
- **Chat side** ("cowork" / local-agent-mode) keeps its own account-scoped store at
  `~/Library/Application Support/Claude/local-agent-mode-sessions/<accountId>/<sessionId>/`.

Verified 2026-07-12 against the shipped app bundle: **the chat side never reads the code
side.** `.claude/plugins` does not appear anywhere in `Claude.app`'s `app.asar`; the chat
side resolves its plugin dir to `<session>/rpm/` instead. Two consequences:

- **The double-registration risk is closed.** Installing the Code-side plugin and writing
  `claude_desktop_config.json` `mcpServers` cannot duplicate the Wenlan MCP server in
  Claude Desktop — they are disjoint surfaces. The wizard may keep doing both.
- **Claude Desktop chat is already connected today** via `claude_desktop_config.json`
  `mcpServers`, which the wizard already writes. A chat-side *plugin* would add skills and
  slash-commands on top; it is not what carries the tools.

### Why we cannot auto-install the chat-side plugin: the registration is server-side

Settled empirically 2026-07-12 — the user added `7xuanlu/wenlan` through Claude Desktop's
chat-side "add marketplace from GitHub" UI, and we diffed the on-disk state before/after.

**What changed:** `<session>/rpm/manifest.json` gained one row —

```json
{ "id": "plugin_01FhUCuja4uzJBGs1oXQ9x3Q", "name": "wenlan",
  "marketplaceId": "marketplace_01QqKemZC8JJUvcEJfeBCqs4",
  "marketplaceName": "wenlan", "installedBy": "user" }
```

— and the plugin content materialized under `<session>/rpm/plugin_01FhUC…/`.

**What did *not* change:** `cowork_settings.json` and `cowork_plugins/known_marketplaces.json`
were both **untouched**. No wenlan entry, no git clone under `marketplaces/`. Grepping the
whole `Claude/` tree for `marketplace_01QqKemZC8JJUvcEJfeBCqs4` finds it only in the
manifest row it produced.

So the GitHub marketplace registration went **to Anthropic's server**, not to disk.
`known_marketplaces.json` / `extraKnownMarketplaces` are a *different, older* path (how
`knowledge-work-plugins` is pre-seeded), not what the GitHub-add button uses.

Therefore **there is no local file Wenlan can write to register the chat-side plugin.** The
marketplace is an account-level object whose `marketplace_01…` ID only Anthropic's server
mints; a forged row would dangle. There is no supported entry point either: `Claude.app`
registers only the `claude://` and MSAL URL schemes (no plugin-install route) and ships no
CLI. **We read this state; we never author it.**

### But the chat-side plugin *does* collide with our MCP write — plugin wins

The installed chat-side plugin ships its own MCP server:

```json
{ "mcpServers": { "wenlan": { "command": "${CLAUDE_PLUGIN_ROOT}/bin/wenlan-mcp-runner.sh" } } }
```

and the wizard writes `claude_desktop_config.json` with `mcpServers.wenlan` too. A user with
both gets Wenlan registered **twice**, from two different binaries. Verified live.

This makes one invariant uniform across every surface:

> **The plugin wins. If a client has the Wenlan plugin, never also write it a raw MCP entry.**

Claude Code and Codex already work this way. Claude Desktop now does too: detect the
chat-side plugin **read-only** (any `<session>/rpm/manifest.json` row with `name == "wenlan"`;
`config.json`'s `lastKnownAccountUuid` pins the account half of the path, the session half is
globbed), count it as already-configured, and skip the `mcpServers` write. Missing file,
missing dir, or malformed JSON means "no plugin" — never an error.

## Also fixed here

The `>` chevron in "Using another MCP client? Show config" renders on its own line above
the sentence. Root cause is not in the wizard: Tailwind preflight sets
`svg { display: block }` (`tailwindcss@4.2.4/preflight.css:217`) and `Button` wraps all
of its children in one plain `<span>`
(`src/components/memory/settings/primitives.tsx:204`), so an svg child becomes a block box
and pushes the label down. Fix the primitive — make that span `inline-flex items-center
gap-1.5` — and every icon+text Button in the app is fixed with it.

## Out of scope

- The cloudflare relay UX. User: not prod-stable-ready; refine later.
- New dependencies. None.
- Any change to `hardcodedCopyBaseline.tsv`.

## Constraints

All copy through `src/i18n/resources.ts` with exact key parity across en / zh-Hans /
zh-Hant. `--mem-*` tokens only. IPC only through `src/lib/tauri.ts`. Decorative glyphs
`aria-hidden`; status text via `aria-describedby`, never inside a `<label>`; toggles
carry `aria-pressed`.

Every load-bearing test must be mutation-proven: break the product code, watch the test
fail, paste the failure, revert with a **targeted edit** — never
`git checkout HEAD -- <file>`.
