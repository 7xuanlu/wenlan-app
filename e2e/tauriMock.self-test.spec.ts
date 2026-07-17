// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauriMock";

test("models detail reads and mutations while rejecting unknown commands", async ({ page }) => {
  // Given a fresh deterministic Tauri fixture runtime.
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await page.goto("/");

  // When detail commands, a mutation, and an intentionally unknown command run.
  const results = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error("Tauri invoke is unavailable");

    const space = await invoke("get_space", { name: "Wenlan" });
    const entity = await invoke("get_entity_detail_cmd", { entityId: "entity-ada" });
    await invoke("create_space", { name: "Created in E2E", description: "Stateful" });
    const spaces = await invoke("list_spaces");

    let unknownError = "";
    try {
      await invoke("todo7_unknown_command");
    } catch (error) {
      unknownError = error instanceof Error ? error.message : String(error);
    }

    let argumentError = "";
    try {
      await invoke("create_space", { name: 42 });
    } catch (error) {
      argumentError = error instanceof Error ? error.message : String(error);
    }

    return { space, entity, spaces, unknownError, argumentError };
  });

  // Then typed details exist, the mutation is visible, and the unknown name is surfaced.
  expect(results.space).toMatchObject({ id: "space-wenlan", name: "Wenlan" });
  expect(results.entity).toMatchObject({ entity: { id: "entity-ada", name: "Ada Lovelace" } });
  expect(results.spaces).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Created in E2E", description: "Stateful" }),
  ]));
  expect(results.unknownError).toContain("todo7_unknown_command");
  expect(results.argumentError).toContain("create_space");
  expect(results.argumentError).toContain("name");
});
