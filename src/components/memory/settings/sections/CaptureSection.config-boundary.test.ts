// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCaptureSection(): string {
  return readFileSync(resolve(here, "CaptureSection.tsx"), "utf8");
}

describe("CaptureSection config boundary", () => {
  it("routes screen-capture settings through the shared Tauri client boundary", () => {
    const page = readCaptureSection();

    expect(page).not.toContain("@tauri-apps/api/core");
    expect(page).toContain("getScreenCaptureEnabled");
    expect(page).toContain("setScreenCaptureEnabled");
    expect(page).toContain("checkScreenPermission");
    expect(page).toContain("requestScreenPermission");
  });
});
