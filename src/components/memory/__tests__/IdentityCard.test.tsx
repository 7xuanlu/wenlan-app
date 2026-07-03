// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IdentityCard from "../IdentityCard";

vi.mock("../../../lib/tauri", () => ({
  getProfile: vi.fn(),
  listEntities: vi.fn(),
  getEntityDetail: vi.fn(),
}));

import * as tauri from "../../../lib/tauri";

function renderIdentityCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IdentityCard onOpenDetail={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(tauri.getProfile).mockResolvedValue({
    id: "p1",
    name: "Lucian",
    display_name: "Lucian",
    email: null,
    bio: null,
    avatar_path: "/missing/avatar.png",
    created_at: 0,
    updated_at: 0,
  } as any);
  vi.mocked(tauri.listEntities).mockResolvedValue([
    { id: "person-lucian", name: "Lucian", entity_type: "person" },
  ] as any);
  vi.mocked(tauri.getEntityDetail).mockResolvedValue({ observations: [] } as any);
});

describe("IdentityCard", () => {
  it("falls back to initials when the saved avatar cannot be loaded", async () => {
    renderIdentityCard();

    const avatar = await screen.findByRole("img", { name: "Lucian" });
    fireEvent.error(avatar);

    expect(screen.queryByRole("img", { name: "Lucian" })).not.toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("shows only avatar and display name without observation text", async () => {
    vi.mocked(tauri.getEntityDetail).mockResolvedValue({
      observations: [{ content: "The user is a senior engineer working on Wenlan." }],
    } as any);

    renderIdentityCard();

    await screen.findByText("Lucian");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tauri.getEntityDetail).not.toHaveBeenCalled();
    expect(screen.queryByText(/senior engineer/i)).not.toBeInTheDocument();
  });
});
