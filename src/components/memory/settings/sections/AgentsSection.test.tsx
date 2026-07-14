// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AgentsSection from "./AgentsSection";

const deleteAgentMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("../../../../lib/tauri", () => ({
  listAgents: vi.fn().mockResolvedValue([
    {
      id: "codex",
      name: "codex",
      display_name: null,
      agent_type: "mcp",
      description: null,
      enabled: true,
      trust_level: "full",
      last_seen_at: null,
      memory_count: 3,
      created_at: 0,
      updated_at: 0,
    },
  ]),
  updateAgent: vi.fn().mockResolvedValue(null),
  deleteAgent: deleteAgentMock,
  detectMcpClients: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../RemoteAccessPanel", () => ({ RemoteAccessPanel: () => <div /> }));
vi.mock("../../../connect/WebPlatformCards", () => ({ default: () => <div /> }));
vi.mock("../../../connect/ClientSetupList", () => ({ default: () => <div /> }));

function renderAgentsSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentsSection />
    </QueryClientProvider>,
  );
}

// Primitives migration (Step 6a): the delete flow moved from a hand-rolled
// row into the Card/Button primitives. The trigger button stayed icon-only
// (no accessible name — adding one needs new i18n copy, out of scope here),
// so it's located by DOM order: the toggle renders first (aria-pressed),
// the delete trigger second.
describe("AgentsSection two-step delete", () => {
  it("requires a second click before deleteAgent fires", async () => {
    const user = userEvent.setup();
    renderAgentsSection();

    const buttons = await screen.findAllByRole("button");
    expect(buttons).toHaveLength(2);
    const [, deleteTrigger] = buttons;

    await user.click(deleteTrigger);
    expect(deleteAgentMock).not.toHaveBeenCalled();

    const confirmButton = await screen.findByText("Confirm");
    await user.click(confirmButton);

    expect(deleteAgentMock).toHaveBeenCalledWith("codex", expect.anything());
  });
});

// S3: the trust legend used to render each level as a hand-styled span with
// a per-level accent border/color. It's a `Tag` now (tone="neutral", no
// accent coloring) — `Tag`'s own signature class is `rounded-full`, which
// the old badge never had, so matching on it proves the swap actually
// happened rather than just trusting the JSX.
describe("AgentsSection trust legend", () => {
  it("renders each trust level as a Tag, not the old accent-bordered badge", async () => {
    renderAgentsSection();

    // The "Full" trust option also appears as a <select> <option>, which
    // never carries Tag's signature class — scoping on `.rounded-full`
    // isolates the legend Tag instead of colliding with it.
    await screen.findAllByRole("button"); // wait for agents query to settle
    const fullTags = Array.from(document.querySelectorAll<HTMLElement>(".rounded-full")).filter(
      (el) => el.textContent === "Full",
    );
    expect(fullTags).toHaveLength(1);
    expect(fullTags[0].style.border).toBe("");
  });
});
