// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const settingsRoot = resolve(here, "..");

function readCaptureSection(): string {
  return readFileSync(resolve(here, "CaptureSection.tsx"), "utf8");
}

function collectTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectTsxFiles(fullPath));
    } else if (entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
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

describe("settings module config boundary", () => {
  it("keeps every settings .tsx module off the direct @tauri-apps/api/core import", () => {
    const tsxFiles = collectTsxFiles(settingsRoot);

    expect(tsxFiles.length).toBeGreaterThan(0);

    for (const filePath of tsxFiles) {
      const source = readFileSync(filePath, "utf8");
      expect(
        source.includes("@tauri-apps/api/core"),
        `${filePath} imports @tauri-apps/api/core directly; route it through src/lib/tauri.ts instead`,
      ).toBe(false);
    }
  });
});
