// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, HANDLERS, liveInvoke } from "./live-invoke";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAURI_TS_PATH = resolve(__dirname, "../../src/lib/tauri.ts");

/** Every command name passed to invoke(...) in src/lib/tauri.ts — both the
 *  plain `invoke("name", ...)` form and the generic-typed `invoke<T>("name")`
 *  form. */
function invokedCommands(source: string): Set<string> {
  const re = /\binvoke(?:<[^>]*>)?\(\s*"([^"]+)"/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[1]);
  return out;
}

describe("liveInvoke list_all_tags", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the full TagData shape (tags + document_tags)", async () => {
    const payload = {
      tags: ["alpha", "beta"],
      document_tags: { "memory::m1": ["alpha"] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    const result = (await liveInvoke("list_all_tags")) as {
      tags: string[];
      document_tags: Record<string, string[]>;
    };

    expect(result.tags).toEqual(["alpha", "beta"]);
    expect(result.document_tags).toEqual({ "memory::m1": ["alpha"] });
  });
});

// The app-local DEFAULTS stand in for Rust commands that never return null. A
// stub that returns null (or the wrong keys) where the real command returns a
// struct does not render an empty panel — it white-screens the whole step,
// because consumers dereference the result unguarded. These pin the shapes that
// actually get dereferenced.
describe("liveInvoke app-local defaults match the real command contracts", () => {
  it("get_remote_access_status is a struct with a status kind, never null", async () => {
    // RemoteAccessPanel reads status.status unguarded; its `= { status: "off" }`
    // useQuery default only covers undefined, so null crashes the connect step.
    const result = await liveInvoke("get_remote_access_status");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("status");
  });

  it("get_setup_status carries the real SetupStatus keys", async () => {
    const result = (await liveInvoke("get_setup_status")) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("setup_completed");
    expect(result).toHaveProperty("anthropic_key_configured");
  });

  it("get_on_device_model exposes a models array the card can map over", async () => {
    const result = (await liveInvoke("get_on_device_model")) as { models: unknown[] };
    expect(result).not.toBeNull();
    expect(Array.isArray(result.models)).toBe(true);
  });
});

// The setup wizard's "setting up" step has three long-running rows — daemon,
// model, import — and all three used to resolve to `null` (wire_state and
// add_source were entirely unmapped; download_on_device_model too), which
// either threw (`wire.daemon` on null) or left the row stuck forever. These
// pin the honest shapes so the rows actually resolve.
describe("liveInvoke wire_state (setup wizard daemon row)", () => {
  it("returns a reachable daemon, a resolved mcp_binary with its candidate trail, and 5 routed clients", async () => {
    const wire = (await liveInvoke("wire_state")) as {
      daemon: { reachable: boolean; base_url: string };
      mcp_binary: { command: string; candidates: { path: string; exists: boolean; source: string }[] };
      clients: { client_type: string; route: string; has_plugin: boolean }[];
    };

    expect(wire.daemon.reachable).toBe(true);
    expect(wire.mcp_binary.command.length).toBeGreaterThan(0);
    expect(wire.mcp_binary.candidates.length).toBeGreaterThan(0);

    expect(wire.clients).toHaveLength(5);
    const codex = wire.clients.find((c) => c.client_type === "codex_cli");
    const claudeCode = wire.clients.find((c) => c.client_type === "claude_code");
    // route_for (app/src/wire_state.rs): claude_code/codex_cli always route to
    // "plugin", never "config" — writing a raw MCP entry for either would
    // double-register the server since their plugins declare their own.
    expect(codex?.route).toBe("plugin");
    expect(claudeCode?.route).toBe("plugin");
    // Matches detect_mcp_clients_cmd's fixture: Codex CLI is the one already
    // configured client.
    expect(codex?.has_plugin).toBe(true);
  });
});

describe("liveInvoke setup wizard import row (add_source -> sync_registered_source)", () => {
  it("add_source echoes the requested type/path back as an Active RegisteredSource", async () => {
    const source = (await liveInvoke("add_source", {
      sourceType: "obsidian",
      path: "/Users/preview/Vaults/Work",
    })) as { source_type: string; path: string; status: string; id: string };

    expect(source.source_type).toBe("obsidian");
    expect(source.path).toBe("/Users/preview/Vaults/Work");
    expect(source.status).toBe("Active");
    expect(source.id.length).toBeGreaterThan(0);
  });

  it("sync_registered_source returns SyncStats with a non-zero ingest count", async () => {
    const stats = (await liveInvoke("sync_registered_source", { id: "preview-source-x" })) as {
      files_found: number;
      ingested: number;
      errors: number;
    };

    expect(stats.ingested).toBeGreaterThan(0);
    expect(stats.errors).toBe(0);
  });
});

// The on-device model row: get_on_device_model used to hardcode `cached: true`
// for both models, which meant `status === "running" && !modelEntry?.cached`
// could never be true — the download phase could never render. This proves
// the download actually stays "uncached" with a moving byte count until it
// resolves, then flips.
describe("liveInvoke on-device model download ramp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays uncached with a ramping byte count until the download resolves, then flips to cached/loaded", async () => {
    expect(await liveInvoke("on_device_model_download_bytes")).toBeNull();
    const before = (await liveInvoke("get_on_device_model")) as {
      models: { id: string; cached: boolean }[];
    };
    expect(before.models.find((m) => m.id === "qwen3-4b")?.cached).toBe(true);

    const download = liveInvoke("download_on_device_model", { modelId: "qwen3-4b" });

    await vi.advanceTimersByTimeAsync(10_000);
    const midBytes = (await liveInvoke("on_device_model_download_bytes")) as number;
    expect(midBytes).toBeGreaterThan(900e6);
    expect(midBytes).toBeLessThan(1_100e6);

    const mid = (await liveInvoke("get_on_device_model")) as {
      loaded: string | null;
      models: { id: string; cached: boolean }[];
    };
    expect(mid.loaded).toBeNull();
    expect(mid.models.find((m) => m.id === "qwen3-4b")?.cached).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    await download;

    // The real Qwen3-4B blob is 2,497,281,120 bytes; the ramp caps there.
    const finalBytes = (await liveInvoke("on_device_model_download_bytes")) as number;
    expect(finalBytes).toBe(2_497_281_120);

    const after = (await liveInvoke("get_on_device_model")) as {
      loaded: string | null;
      models: { id: string; cached: boolean }[];
    };
    expect(after.loaded).toBe("qwen3-4b");
    expect(after.models.find((m) => m.id === "qwen3-4b")?.cached).toBe(true);
  });
});

// DEBT: 79 commands with no harness stub as of 2026-07-13, predating this fix
// and out of scope for it — spaces CRUD, entity/observation CRUD, snapshots,
// agent management, obsidian export/import, avatar, remote-access token
// rotation, native file/dialog commands, and a handful of others. None are
// reachable from a screen this fix touches, and liveInvoke's fallback (warn +
// return null) means they fail soft today rather than crash.
//
// This is a two-way ratchet, not a permanent excuse list: the coverage test
// below fails on any command outside this set with no stub (the bug class —
// ship an invoke() with nothing behind it), AND on any entry here that has
// since been stubbed or deleted from tauri.ts (so backfilling a gap, or
// removing a dead command, means deleting its name from here — the count can
// only go down). If this number ever goes up, that's a regression to justify
// in the PR, not a rebase footgun to silently resolve.
const UNSTUBBED_DEBT = new Set([
  "acknowledge_onboarding_milestone",
  "add_observation_cmd",
  "add_space",
  "add_watch_path",
  "confirm_entity_cmd",
  "confirm_observation_cmd",
  "confirm_space",
  "connect_source",
  "correct_memory_cmd",
  "create_entity_cmd",
  "create_space",
  "daemon_version",
  "delete_agent",
  "delete_bulk",
  "delete_by_time_range",
  "delete_entity_cmd",
  "delete_file_chunks",
  "delete_observation_cmd",
  "delete_snapshot",
  "delete_space",
  "delete_tag",
  "detect_obsidian_vaults",
  "disconnect_source",
  "dismiss_contradiction",
  "export_page_to_obsidian",
  "export_pages_to_obsidian",
  "get_agent",
  "get_chunks",
  "get_enrichment_status",
  "get_external_llm_key_configured",
  "get_pending_revision",
  "get_snapshot_captures",
  "get_snapshot_captures_with_content",
  "get_space",
  "import_chat_export",
  "import_memories_cmd",
  "ingest_webpage",
  "install_client_plugin",
  "list_external_models",
  "move_space",
  "open_file",
  "pin_space",
  "quick_capture",
  "read_source_dir",
  "read_text_file",
  "rebuild_activities",
  "reclassify_memory_cmd",
  "regenerate_narrative",
  "reindex",
  "remove_avatar",
  "remove_legacy_mcp_entry",
  "remove_raw_mcp_entry",
  "remove_source",
  "remove_space",
  "remove_watch_path",
  "rename_space",
  "reorder_space",
  "reset_onboarding_milestones",
  "rotate_remote_token",
  "save_temp_file",
  "set_api_key",
  "set_avatar",
  "set_document_space",
  "set_document_tags",
  "set_external_llm",
  "set_model_choice",
  "set_run_at_login",
  "set_stability_cmd",
  "sync_source",
  "test_external_llm",
  "test_remote_mcp_connection",
  "toggle_remote_access",
  "toggle_space_starred",
  "update_agent",
  "update_chunk",
  "update_observation_cmd",
  "update_profile",
  "update_space",
  "upload_source_file",
  "write_mcp_config",
]);

// This is the test that would have caught all three commands the setup
// wizard's "setting up" step silently rendered against null (wire_state,
// download_on_device_model, add_source) — and fails the moment a future
// invoke() ships with no harness stub at all. One-directional on purpose: an
// unused extra HANDLERS/DEFAULTS entry is fine, a missing one is the bug.
describe("tauri.ts -> live-invoke.ts command coverage (parity)", () => {
  const source = readFileSync(TAURI_TS_PATH, "utf8");
  const commands = invokedCommands(source);
  const covered = new Set([...Object.keys(HANDLERS), ...Object.keys(DEFAULTS)]);

  it("extracted a realistic number of commands (extraction regex sanity floor)", () => {
    // If tauri.ts's invoke() calls ever stopped matching the regex above (a
    // refactor to a different call style, say), `commands` would silently
    // shrink toward empty and both assertions below would vacuously pass.
    expect(commands.size).toBeGreaterThan(150);
  });

  it("every invoke() command has a live-invoke entry, or is tracked as debt", () => {
    const uncovered = [...commands].filter((c) => !covered.has(c) && !UNSTUBBED_DEBT.has(c)).sort();
    expect(uncovered).toEqual([]);
  });

  // The other half of the ratchet: an entry that's been stubbed (covered) or
  // whose command no longer exists (deleted from tauri.ts) must be removed
  // from UNSTUBBED_DEBT — otherwise the list only ever grows and "debt" stops
  // meaning anything.
  it("UNSTUBBED_DEBT has no stale entries (already covered, or no longer invoked)", () => {
    const stale = [...UNSTUBBED_DEBT].filter((c) => covered.has(c) || !commands.has(c)).sort();
    expect(stale).toEqual([]);
  });

  it("the commands this fix targeted are real entries, not tracked as debt", () => {
    for (const cmd of [
      "wire_state",
      "download_on_device_model",
      "get_on_device_model",
      "on_device_model_download_bytes",
      "add_source",
      "sync_registered_source",
    ]) {
      expect(covered.has(cmd)).toBe(true);
      expect(UNSTUBBED_DEBT.has(cmd)).toBe(false);
    }
  });
});
