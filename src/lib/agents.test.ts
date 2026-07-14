// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { resolveAgentDisplayName } from "./agents";
import type { AgentConnection } from "./tauri";

describe("resolveAgentDisplayName", () => {
  it("uses the built-in registry for known IDs", () => {
    expect(resolveAgentDisplayName("claude-code")).toBe("Claude Code");
    expect(resolveAgentDisplayName("codex")).toBe("Codex");
  });

  it("prefers a user's registered display_name over the registry", () => {
    const connections: AgentConnection[] = [
      { name: "claude-code", display_name: "My Laptop" } as AgentConnection,
    ];
    expect(resolveAgentDisplayName("claude-code", connections)).toBe("My Laptop");
  });

  it("prettifies an unrecognized slug instead of passing it through raw", () => {
    expect(resolveAgentDisplayName("codex-mcp-client")).toBe("Codex MCP Client");
  });

  it("applies the acronym map for cli/api/ai/vscode", () => {
    expect(resolveAgentDisplayName("codex-ulw-loop")).toBe("Codex Ulw Loop");
    expect(resolveAgentDisplayName("cursor-vscode")).toBe("Cursor VS Code");
    expect(resolveAgentDisplayName("some-ai-cli")).toBe("Some AI CLI");
  });

  it("handles underscores the same as hyphens", () => {
    expect(resolveAgentDisplayName("foo_bar_baz")).toBe("Foo Bar Baz");
  });

  it("never returns empty for a non-empty input", () => {
    expect(resolveAgentDisplayName("x")).toBe("X");
  });
});
