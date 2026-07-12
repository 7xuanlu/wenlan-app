// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "../../i18n";

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import CliPrimaryPath from "./CliPrimaryPath";

const COMMAND1 = "/plugin marketplace add 7xuanlu/claude-plugins";
const COMMAND2 = "/plugin install wenlan@7xuanlu";
const COMMAND3 = "/setup";

function renderPathWithCommandsOpen() {
  const result = render(<CliPrimaryPath />);
  fireEvent.click(screen.getByText("Show terminal commands"));
  return result;
}

describe("CliPrimaryPath", () => {
  afterEach(() => {
    vi.useRealTimers();
    mocks.clipboardWrite.mockReset();
    mocks.clipboardWrite.mockResolvedValue(undefined);
  });

  it("leads with the plugin-install prompt and a primary copy button", () => {
    render(<CliPrimaryPath />);
    expect(
      screen.getByText(
        "Copy the setup prompt and paste it into Claude Code — it sets itself up.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy setup prompt" })).toBeInTheDocument();
  });

  it("clicking 'Copy setup prompt' copies the full agent-runnable prompt, not a single command", async () => {
    render(<CliPrimaryPath />);
    fireEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));
    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1));
    const copied = mocks.clipboardWrite.mock.calls[0][0] as string;
    expect(copied).toContain(COMMAND1);
    expect(copied).toContain(COMMAND2);
    expect(copied).toContain(COMMAND3);
  });

  it("the terminal commands are collapsed behind a disclosure, not shown by default", () => {
    render(<CliPrimaryPath />);
    // jsdom doesn't apply the native `details:not([open]) > *` UA rule, so a
    // text query alone can't tell open from closed — check the <details>
    // element's own `open` property instead.
    const details = screen.getByText(COMMAND1).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Show terminal commands")).toBeInTheDocument();
  });

  it("renders all three commands with one copy button each once expanded", () => {
    renderPathWithCommandsOpen();
    expect(screen.getByText(COMMAND1)).toBeInTheDocument();
    expect(screen.getByText(COMMAND2)).toBeInTheDocument();
    expect(screen.getByText(COMMAND3)).toBeInTheDocument();
    const commandCopyButtons = screen.getAllByRole("button", { name: /^Copy command:/ });
    expect(commandCopyButtons).toHaveLength(3);
  });

  it("clicking a command's copy button writes exactly that command's text", async () => {
    renderPathWithCommandsOpen();
    const buttons = screen.getAllByRole("button", { name: /^Copy command:/ });

    fireEvent.click(buttons[1]);
    await waitFor(() => {
      expect(mocks.clipboardWrite).toHaveBeenCalledWith(COMMAND2);
    });
    expect(mocks.clipboardWrite).not.toHaveBeenCalledWith(COMMAND1);
    expect(mocks.clipboardWrite).not.toHaveBeenCalledWith(COMMAND3);
  });

  it("a command's Copied state resets after ~2s without affecting a sibling command", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPathWithCommandsOpen();
    const buttons = screen.getAllByRole("button", { name: /^Copy command:/ });

    fireEvent.click(buttons[0]);
    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledWith(COMMAND1));
    expect(buttons[0]).toHaveTextContent("Copied");
    expect(buttons[1]).toHaveTextContent("Copy");

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(buttons[0]).toHaveTextContent("Copy"));
    expect(buttons[0]).not.toHaveTextContent("Copied");
  });

  it("the 'Copy setup prompt' button's Copied state also resets after ~2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CliPrimaryPath />);
    const promptButton = screen.getByRole("button", { name: "Copy setup prompt" });

    fireEvent.click(promptButton);
    await waitFor(() => expect(promptButton).toHaveTextContent("Prompt copied"));

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(promptButton).toHaveTextContent("Copy setup prompt"));
  });
});
