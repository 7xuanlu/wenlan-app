// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReviewRuntime,
  invoke,
  resetReviewRuntime,
} from "../review/tauri-core";

describe("Review fixture IPC", () => {
  beforeEach(() => {
    resetReviewRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves known commands without network access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const spaces = await invoke("list_spaces") as Array<{ name: string }>;

    expect(spaces.map((space) => space.name)).toContain("Wenlan");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes deterministic Page candidate and cleanup review states", async () => {
    const discovery = await invoke("distill_review") as {
      pending: Array<{ existing_page_id?: string | null; source_ids: string[] }>;
    };
    const refinements = await invoke("list_refinements", { limit: 50 }) as {
      proposals: Array<{ action: string; payload?: { page_id?: string } | null }>;
    };
    const pages = await invoke("list_pages", { status: "active", limit: 500, offset: 0 }) as Array<{
      id: string;
      review_status?: string;
    }>;

    expect(discovery.pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_ids: expect.any(Array) }),
    ]));
    expect(refinements.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "page_keep_or_archive",
        payload: expect.objectContaining({ page_id: expect.any(String) }),
      }),
    ]));
    expect(pages.some((page) => page.review_status === "unconfirmed")).toBe(true);
  });

  it("keeps every declared Graph entity resolvable through its detail command", async () => {
    const entities = await invoke("list_entities_cmd", {
      entityType: null,
      domain: null,
    }) as Array<{ id: string }>;

    expect(entities).toHaveLength(7);
    for (const entity of entities) {
      await expect(invoke("get_entity_detail_cmd", { entityId: entity.id })).resolves.toMatchObject({
        entity: { id: entity.id },
      });
    }
  });

  it("creates an authored Page in the isolated Review runtime", async () => {
    const result = await invoke("create_page", {
      title: "Manual review note",
      content: "Written inside the fixture-only Review app.",
      space: null,
    }) as { id: string; attached_to?: string | null; warnings: string[] };

    expect(result).toMatchObject({ attached_to: null, warnings: [] });
    const created = await invoke("get_page", { id: result.id }) as {
      content: string;
      creation_kind?: string | null;
      review_status?: string | null;
      space?: string | null;
      title: string;
    };
    expect(created).toMatchObject({
      title: "Manual review note",
      content: "Written inside the fixture-only Review app.",
      creation_kind: "authored",
      review_status: "unconfirmed",
      space: null,
    });
    const pages = await invoke("list_pages", { status: "active", limit: 500, offset: 0 }) as Array<{ id: string }>;
    expect(pages.map((page) => page.id)).toContain(result.id);
  });

  it("always mints a legacy authored Page even when its title matches a fixture Page", async () => {
    const pagesBefore = await invoke("list_pages", { status: "active", limit: 500, offset: 0 }) as Array<{
      id: string;
      title: string;
    }>;
    const destination = pagesBefore.find((page) => page.title === "Fixture architecture");
    expect(destination).toBeDefined();

    const result = await invoke("create_page", {
      title: "  Fixture architecture  ",
      content: "Additional authored context for the existing fixture Page.",
      space: "Wenlan",
    }) as { id: string; attached_to?: string | null; warnings: string[] };
    const pagesAfter = await invoke("list_pages", { status: "active", limit: 500, offset: 0 }) as Array<{
      id: string;
      title: string;
    }>;

    expect(result).toMatchObject({ attached_to: null, warnings: [] });
    expect(result.id).not.toBe(destination?.id);
    expect(pagesAfter).toHaveLength(pagesBefore.length + 1);
  });

  it("models Page draft partial saves, CAS, publish conflicts, and discard", async () => {
    const draft = await invoke("create_page_draft", {
      clientDraftId: "page_00000000-0000-4000-8000-000000000001",
      title: "",
      content: "  partial fixture body  \n",
      space: null,
    }) as { id: string; version: number; status: string; content: string };
    expect(draft).toMatchObject({
      version: 1,
      status: "draft",
      content: "  partial fixture body  \n",
    });

    await expect(invoke("update_page_draft", {
      id: draft.id,
      expectedVersion: 0,
      title: "stale",
      content: "stale",
      space: null,
    })).rejects.toThrow('"code":"draft_version_conflict"');

    await expect(invoke("update_page_draft", {
      id: draft.id,
      expectedVersion: 1,
      title: " ",
      content: "\n",
      space: "Wenlan",
    })).rejects.toThrow('"code":"invalid_page_draft"');

    const updated = await invoke("update_page_draft", {
      id: draft.id,
      expectedVersion: 1,
      title: "Fixture draft",
      content: "Fixture draft body",
      space: null,
    }) as { id: string; version: number };
    const published = await invoke("publish_page_draft", {
      id: draft.id,
      expectedVersion: updated.version,
    }) as { id: string; version: number; status: string; review_status: string };
    expect(published).toMatchObject({
      id: draft.id,
      version: updated.version + 1,
      status: "active",
      review_status: "unconfirmed",
    });

    const collidingDraft = await invoke("create_page_draft", {
      clientDraftId: "page_00000000-0000-4000-8000-000000000002",
      title: " Fixture architecture ",
      content: "Conflicting fixture body",
      space: "Wenlan",
    }) as { id: string; version: number };
    await expect(invoke("publish_page_draft", {
      id: collidingDraft.id,
      expectedVersion: collidingDraft.version,
    })).rejects.toThrow('"code":"page_title_conflict"');

    const disposable = await invoke("create_page_draft", {
      clientDraftId: "page_00000000-0000-4000-8000-000000000003",
      title: "Disposable",
      content: "",
      space: null,
    }) as { id: string; version: number };
    await expect(invoke("discard_page_draft", {
      id: disposable.id,
      expectedVersion: disposable.version,
    })).resolves.toBeNull();
    await expect(invoke("get_page", { id: disposable.id })).resolves.toBeNull();

    await expect(invoke("create_page_draft", {
      clientDraftId: "page_00000000-0000-4000-8000-000000000004",
      title: "   ",
      content: "\n",
      space: "Wenlan",
    })).rejects.toThrow('"code":"invalid_page_draft"');
  });

  it("deduplicates an ambiguous create retry by its client-generated draft id", async () => {
    const clientDraftId = "page_11111111-1111-4111-8111-111111111111";
    const before = await invoke("list_pages", {
      status: "draft",
      limit: 500,
      offset: 0,
    }) as Array<{ id: string }>;
    const input = {
      clientDraftId,
      title: "Ambiguous response",
      content: "The first response was lost.",
      space: null,
    };

    const first = await invoke("create_page_draft", input) as { id: string; version: number };
    const retried = await invoke("create_page_draft", input) as { id: string; version: number };
    const after = await invoke("list_pages", {
      status: "draft",
      limit: 500,
      offset: 0,
    }) as Array<{ id: string }>;

    expect(first).toMatchObject({ id: clientDraftId, version: 1 });
    expect(retried).toEqual(first);
    expect(after).toHaveLength(before.length + 1);
  });

  it("matches backend Unicode lowercase independently of the host locale", async () => {
    const nativeLocaleLowercase = String.prototype.toLocaleLowerCase;
    const localeLowercase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string) {
        return nativeLocaleLowercase.call(this, "tr");
      });

    try {
      await invoke("create_page", {
        title: "I ΣΧΕΔΙΟ ПРОЕКТ",
        content: "Existing locale-sensitive title.",
        space: "Wenlan",
      });
      const draft = await invoke("create_page_draft", {
        clientDraftId: "page_00000000-0000-4000-8000-000000000005",
        title: "i σχεδιο проект",
        content: "Draft body",
        space: "Wenlan",
      }) as { id: string; version: number };

      await expect(invoke("publish_page_draft", {
        id: draft.id,
        expectedVersion: draft.version,
      })).rejects.toThrow('"code":"page_title_conflict"');
    } finally {
      localeLowercase.mockRestore();
    }
  });

  it("starts every new runtime from a pristine fixture", async () => {
    const first = createReviewRuntime();
    await first.invoke("create_space", { name: "Ephemeral review edit" });
    const edited = await first.invoke("list_spaces") as Array<{ name: string }>;

    const second = createReviewRuntime();
    const pristine = await second.invoke("list_spaces") as Array<{ name: string }>;

    expect(edited.map((space) => space.name)).toContain("Ephemeral review edit");
    expect(pristine.map((space) => space.name)).not.toContain("Ephemeral review edit");
  });

  it("reset replaces the process-local singleton fixture", async () => {
    await invoke("create_space", { name: "Reset me" });
    resetReviewRuntime();

    const spaces = await invoke("list_spaces") as Array<{ name: string }>;
    expect(spaces.map((space) => space.name)).not.toContain("Reset me");
  });

  it("fails closed for unknown app and plugin commands", async () => {
    await expect(invoke("unknown_review_command")).rejects.toThrow(
      "Unknown Tauri command: unknown_review_command",
    );
    await expect(invoke("plugin:updater|check")).rejects.toThrow(
      "Unknown Tauri command: plugin:updater|check",
    );
  });
});
