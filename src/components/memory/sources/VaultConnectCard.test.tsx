// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../i18n";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  detectVault: vi.fn(),
  addSource: vi.fn(),
  syncRegisteredSource: vi.fn(),
  listRegisteredSources: vi.fn(),
  detectObsidianVaults: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));
vi.mock("../../../lib/vaultDetection", () => ({ detectVault: mocks.detectVault }));
vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    addSource: mocks.addSource,
    syncRegisteredSource: mocks.syncRegisteredSource,
    listRegisteredSources: mocks.listRegisteredSources,
    detectObsidianVaults: mocks.detectObsidianVaults,
  };
});

import VaultConnectCard from "./VaultConnectCard";

function renderCard(props: Partial<React.ComponentProps<typeof VaultConnectCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VaultConnectCard variant="wizard" {...props} />
    </QueryClientProvider>
  );
}

const SOURCE = {
  id: "s1",
  source_type: "obsidian",
  path: "/v",
  status: "Active",
  last_sync: null,
  file_count: 12,
  memory_count: 3,
};

describe("VaultConnectCard", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.openDialog.mockResolvedValue("/v");
    mocks.addSource.mockResolvedValue(SOURCE);
    mocks.syncRegisteredSource.mockResolvedValue({
      files_found: 12, ingested: 12, skipped: 0, errors: 0,
    });
    mocks.listRegisteredSources.mockResolvedValue([SOURCE]);
    mocks.detectObsidianVaults.mockResolvedValue([]);
  });

  it("zero-count detection warns but does NOT block submit (council change e)", async () => {
    mocks.detectVault.mockResolvedValue({
      isVault: false, sourceType: "directory", docCount: 0,
      countCapped: false, hasValidDoc: false, unreadable: false,
    });
    renderCard();
    await userEvent.click(screen.getByText("Browse…"));
    await waitFor(() =>
      expect(screen.getByText(/No notes found/)).toBeInTheDocument()
    );
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeEnabled();
  });

  it("connects an obsidian vault: addSource + one-shot sync + indexed line", async () => {
    mocks.detectVault.mockResolvedValue({
      isVault: true, sourceType: "obsidian", docCount: 12,
      countCapped: false, hasValidDoc: true, unreadable: false,
    });
    renderCard();
    await userEvent.click(screen.getByText("Browse…"));
    await waitFor(() => expect(screen.getByText(/Detected \.obsidian\//)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mocks.addSource).toHaveBeenCalledWith("obsidian", "/v"));
    await waitFor(() => expect(mocks.syncRegisteredSource).toHaveBeenCalledWith("s1"));
    await waitFor(() =>
      expect(screen.getByText(/Indexed 12 files/)).toBeInTheDocument()
    );
  });

  it("surfaces daemon 4xx verbatim", async () => {
    mocks.detectVault.mockResolvedValue({
      isVault: false, sourceType: "directory", docCount: 3,
      countCapped: false, hasValidDoc: true, unreadable: false,
    });
    mocks.addSource.mockRejectedValue(new Error("path does not exist: /v"));
    renderCard();
    await userEvent.click(screen.getByText("Browse…"));
    await waitFor(() => expect(screen.getByText(/3 supported files/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    let errorEl: HTMLElement;
    await waitFor(() => {
      errorEl = screen.getByText(/path does not exist: \/v/);
      expect(errorEl).toBeInTheDocument();
    });
    // Danger-text token, not a raw Tailwind color (a mutation back to
    // text-red-500 would fail this while leaving the text assertion green).
    expect(errorEl!).toHaveStyle({ color: "var(--mem-status-danger-text)" });
    expect(errorEl!.className).not.toContain("text-red-500");
  });

  it("renders Obsidian vault chips and clicking one populates the path input", async () => {
    mocks.detectObsidianVaults.mockResolvedValue([
      { name: "Work Notes", path: "/Users/x/Vaults/Work Notes" },
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByText("Work Notes")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Work Notes"));
    await waitFor(() =>
      expect(screen.getByDisplayValue("/Users/x/Vaults/Work Notes")).toBeInTheDocument()
    );
  });

  it("connecting a chip-picked vault calls addSource(obsidian, path) and never runs vault detection", async () => {
    mocks.detectObsidianVaults.mockResolvedValue([
      { name: "Work Notes", path: "/Users/x/Vaults/Work Notes" },
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByText("Work Notes")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Work Notes"));
    await waitFor(() =>
      expect(screen.getByText(/Obsidian vault — Work Notes/)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(mocks.addSource).toHaveBeenCalledWith("obsidian", "/Users/x/Vaults/Work Notes")
    );
    expect(mocks.detectVault).not.toHaveBeenCalled();
  });

  it("zero vaults: no chip row, card behaves exactly as it does today", async () => {
    mocks.detectVault.mockResolvedValue({
      isVault: false, sourceType: "directory", docCount: 3,
      countCapped: false, hasValidDoc: true, unreadable: false,
    });
    renderCard();
    await userEvent.click(screen.getByText("Browse…"));
    // By the time detection resolves and re-renders, the (mocked, instantly
    // resolving) obsidian-vaults query has settled too — a reliable point to
    // assert its absence, unlike asserting right after render.
    await waitFor(() => expect(screen.getByText(/3 supported files/)).toBeInTheDocument());
    expect(screen.queryByText("Your Obsidian vaults")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mocks.addSource).toHaveBeenCalledWith("directory", "/v"));
  });

  // The chip row is conditional on detection, so it cannot be what tells a user
  // that Obsidian is supported — someone with Obsidian installed but no readable
  // registry entry would see no mention of it at all. Support is stated
  // unconditionally, and this pins the case the chips do NOT cover.
  it("states Obsidian support even when zero vaults are detected", async () => {
    renderCard();
    expect(
      await screen.findByText("Obsidian vaults — indexes your Markdown notes"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Any folder — indexes .md, .txt, and .pdf files"),
    ).toBeInTheDocument();
    // ...and it is genuinely the no-vault case, not the chip row in disguise.
    expect(screen.queryByText("Your Obsidian vaults")).not.toBeInTheDocument();
  });
});
