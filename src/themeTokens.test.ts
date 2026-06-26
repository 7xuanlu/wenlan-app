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

describe("dark theme brand tokens", () => {
  it("uses the logo/social-preview navy palette instead of purple surfaces", () => {
    expect(rootToken("--bg-primary")).toBe("#121217");
    expect(rootToken("--bg-secondary")).toBe("#171A24");
    expect(rootToken("--border")).toBe("#2B3548");

    expect(darkToken("--mem-bg")).toBe("#121217");
    expect(darkToken("--mem-surface")).toBe("#171A24");
    expect(darkToken("--mem-sidebar")).toBe("#10121A");
    expect(darkToken("--mem-border")).toBe("#2B3548");
    expect(darkToken("--mem-accent-indigo")).toBe("#5BA3E6");
  });
});
