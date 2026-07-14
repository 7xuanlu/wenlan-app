// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REVIEW_STATE } from "../fixtures";
import { invoke } from "./core";
import { liveInvoke } from "./live-invoke";

vi.mock("./live-invoke", () => ({
  liveInvoke: vi.fn(async () => ({ deleted: true })),
}));

// The wizard's runtime row stores a REAL memory in the maintainer's own daemon
// (store_memory and list_recent_memories both fall through to liveInvoke) and
// then deletes it. When this fixture owned every `delete_memory`, that delete
// was swallowed and each preview of the wizard left a real "Wenlan setup check"
// memory behind in the developer's database. The fixture may only delete what
// the fixture itself owns.
describe("preview core.ts — delete_memory in fixture mode", () => {
  beforeEach(() => {
    vi.mocked(liveInvoke).mockClear();
    (window as { __PREVIEW_FIXTURES__?: boolean }).__PREVIEW_FIXTURES__ = true;
    REVIEW_STATE.captures = [
      { id: "cap_1" },
      { id: "cap_2" },
    ] as unknown as typeof REVIEW_STATE.captures;
  });

  it("deletes a review-queue capture from the fixture, without touching the daemon", async () => {
    await invoke("delete_memory", { sourceId: "cap_1" });

    expect(REVIEW_STATE.captures.map((c) => c.id)).toEqual(["cap_2"]);
    expect(liveInvoke).not.toHaveBeenCalled();
  });

  it("delegates a non-fixture id (the wizard's real probe memory) to the live daemon", async () => {
    const result = await invoke("delete_memory", { sourceId: "mem_real_probe" });

    expect(liveInvoke).toHaveBeenCalledWith("delete_memory", {
      sourceId: "mem_real_probe",
    });
    expect(result).toEqual({ deleted: true });
    expect(REVIEW_STATE.captures.map((c) => c.id)).toEqual(["cap_1", "cap_2"]);
  });
});
