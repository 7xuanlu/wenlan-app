// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveInvoke } from "./live-invoke";

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
