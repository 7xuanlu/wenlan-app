// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import App from "./App";

vi.mock("./lib/tauri", () => ({
  shouldShowWizard: vi.fn(),
  setSetupCompleted: vi.fn().mockResolvedValue(undefined),
  setTrafficLightsVisible: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/resizeWindow", () => ({
  resizeWindow: vi.fn(),
  resizeWindowCentered: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setAlwaysOnTop: vi.fn(),
    isVisible: vi.fn().mockResolvedValue(true),
    show: vi.fn(),
    setFocus: vi.fn(),
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    scaleFactor: vi.fn().mockResolvedValue(1),
  }),
  LogicalSize: vi.fn(),
  LogicalPosition: vi.fn(),
  currentMonitor: vi.fn().mockResolvedValue(null),
}));

// Heavy real children — swap for markers so this test only pins App's own
// wizard-vs-home branching, not Main's or SetupWizard's internals.
vi.mock("./components/memory/Main", () => ({
  default: () => <div data-testid="home-main">home</div>,
}));

vi.mock("./components/SetupWizard", () => ({
  default: () => <div data-testid="setup-wizard">wizard</div>,
}));

// EntityDetail transitively imports AtlasView → sigma, whose dist touches
// WebGL2RenderingContext at module scope — jsdom has no such global, so the
// real import crashes this whole suite before a single test runs.
vi.mock("./components/memory/EntityDetail", () => ({
  default: () => null,
}));

vi.mock("./components/onboarding/MilestoneToaster", () => ({
  MilestoneToaster: () => null,
}));

vi.mock("./components/UpdaterDialog", () => ({
  default: () => null,
}));

import { shouldShowWizard } from "./lib/tauri";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App - first-run wizard gate", () => {
  beforeEach(() => {
    vi.mocked(shouldShowWizard).mockReset();
  });

  it("renders Home when shouldShowWizard resolves false", async () => {
    vi.mocked(shouldShowWizard).mockResolvedValue(false);
    renderApp();

    expect(await screen.findByTestId("home-main")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-wizard")).not.toBeInTheDocument();
  });

  it("renders SetupWizard when shouldShowWizard resolves true", async () => {
    vi.mocked(shouldShowWizard).mockResolvedValue(true);
    renderApp();

    expect(await screen.findByTestId("setup-wizard")).toBeInTheDocument();
    expect(screen.queryByTestId("home-main")).not.toBeInTheDocument();
  });

  // The gate asks the daemon over localhost IPC, so it must still answer on a
  // machine with no network. Under react-query's default "online" networkMode
  // an offline browser PAUSES the query (fetchStatus "paused", never
  // "fetching"), which would strand the gate with no data and no error.
  it("still answers the gate when the machine is offline", async () => {
    onlineManager.setOnline(false);
    try {
      vi.mocked(shouldShowWizard).mockResolvedValue(true);
      renderApp();

      expect(await screen.findByTestId("setup-wizard")).toBeInTheDocument();
      expect(screen.queryByTestId("home-main")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // The daemon's first-run install is async (app/src/lib.rs) and can race this
  // query past its own retry budget. App.tsx's per-query retry (5 attempts,
  // exponential backoff capped at 3s, ~12s total) overrides main.tsx's global
  // retry:false, so this exercises the REAL production retry policy end to
  // end rather than a shortened test double — hence the generous timeout.
  it(
    "fails closed to SetupWizard when shouldShowWizard rejects (daemon unreachable)",
    async () => {
      vi.mocked(shouldShowWizard).mockRejectedValue(new Error("connection refused"));
      renderApp();

      expect(
        await screen.findByTestId("setup-wizard", {}, { timeout: 20000 }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("home-main")).not.toBeInTheDocument();
      // Proves retries actually happened, not just a single failed attempt.
      expect(vi.mocked(shouldShowWizard).mock.calls.length).toBeGreaterThan(1);
    },
    25000,
  );
});
