// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readSettingsPage(): string {
  return readFileSync(resolve(here, "SettingsPage.tsx"), "utf8");
}

describe("SettingsPage config boundary", () => {
  it("routes screen-capture settings through the shared Tauri client boundary", () => {
    const page = readSettingsPage();

    expect(page).not.toContain("@tauri-apps/api/core");
    expect(page).toContain("getScreenCaptureEnabled");
    expect(page).toContain("setScreenCaptureEnabled");
    expect(page).toContain("checkScreenPermission");
    expect(page).toContain("requestScreenPermission");
  });
});
