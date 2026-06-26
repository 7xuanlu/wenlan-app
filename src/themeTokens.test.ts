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

function expectNeutralGraphite(hex: string | null): void {
  expect(hex).not.toBeNull();
  const color = rgb(hex ?? "");
  const channels = [color.r, color.g, color.b];
  const spread = Math.max(...channels) - Math.min(...channels);

  expect(spread).toBeLessThanOrEqual(18);
  expect(color.r).toBeLessThanOrEqual(color.g);
  expect(color.r).toBeLessThanOrEqual(color.b);
}

describe("dark theme brand tokens", () => {
  it("uses a professional graphite-gray scale while brand colors are unsettled", () => {
    expect(rootToken("--bg-primary")).toBe("#202124");
    expect(rootToken("--bg-secondary")).toBe("#272A2E");
    expect(rootToken("--border")).toBe("#3B4047");

    expect(darkToken("--mem-bg")).toBe("#202124");
    expect(darkToken("--mem-surface")).toBe("#272A2E");
    expect(darkToken("--mem-sidebar")).toBe("#181B1F");
    expect(darkToken("--mem-border")).toBe("#3B4047");
    expect(darkToken("--mem-accent-indigo")).toBe("#A4ACB6");
  });

  it("keeps dark structural surfaces neutral instead of purple or blue-led", () => {
    for (const token of [
      rootToken("--bg-primary"),
      rootToken("--bg-secondary"),
      darkToken("--mem-bg"),
      darkToken("--mem-surface"),
      darkToken("--mem-sidebar"),
    ]) {
      expectNeutralGraphite(token);
    }
  });
});
