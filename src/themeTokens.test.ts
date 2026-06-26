// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");

function darkToken(name: string): string | null {
  const darkBlock = css.match(/:root,\s*html\[data-theme="dark"\]\s*\{(?<body>[\s\S]*?)\n\}/);
  const body = darkBlock?.groups?.body ?? "";
  return body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? null;
}

function rootToken(name: string): string | null {
  const rootBlock = css.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/);
  const body = rootBlock?.groups?.body ?? "";
  return body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? null;
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const match = hex.match(/^#(?<r>[0-9A-F]{2})(?<g>[0-9A-F]{2})(?<b>[0-9A-F]{2})$/i);
  if (!match?.groups) {
    throw new Error(`Expected hex color, got ${hex}`);
  }
  return {
    r: Number.parseInt(match.groups.r, 16),
    g: Number.parseInt(match.groups.g, 16),
    b: Number.parseInt(match.groups.b, 16),
  };
}

function expectBlueNeutralNavy(hex: string | null): void {
  expect(hex).not.toBeNull();
  const color = rgb(hex ?? "");

  expect(color.g).toBeGreaterThan(color.r);
  expect(color.b).toBeGreaterThan(color.g);
}

describe("dark theme brand tokens", () => {
  it("uses a professional graphite-blue scale instead of violet icon colors", () => {
    expect(rootToken("--bg-primary")).toBe("#151A20");
    expect(rootToken("--bg-secondary")).toBe("#1C242D");
    expect(rootToken("--border")).toBe("#303A46");

    expect(darkToken("--mem-bg")).toBe("#151A20");
    expect(darkToken("--mem-surface")).toBe("#1C242D");
    expect(darkToken("--mem-sidebar")).toBe("#10151B");
    expect(darkToken("--mem-border")).toBe("#303A46");
    expect(darkToken("--mem-accent-indigo")).toBe("#64B5D9");
  });

  it("keeps dark structural surfaces out of the purple hue family", () => {
    for (const token of [
      rootToken("--bg-primary"),
      rootToken("--bg-secondary"),
      darkToken("--mem-bg"),
      darkToken("--mem-surface"),
      darkToken("--mem-sidebar"),
    ]) {
      expectBlueNeutralNavy(token);
    }
  });
});
