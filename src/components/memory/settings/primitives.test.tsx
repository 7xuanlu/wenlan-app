// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "../../../i18n";
import { Button, Field, Input, StatusChip, Toggle } from "./primitives";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("StatusChip", () => {
  it("renders the success token triplet for an up state", () => {
    render(<StatusChip state={{ kind: "up", detail: "Ollama 0.6.2" }} label="Ollama" />);
    const chip = screen.getByText(/Ollama/).closest("span[aria-live]") as HTMLElement;
    expect(chip.className).toContain("bg-[var(--mem-status-success-bg)]");
    expect(chip.className).toContain("text-[var(--mem-status-success-text)]");
    expect(chip.className).toContain("border-[var(--mem-status-success-border)]");
    expect(screen.getByText("Ollama · Ollama 0.6.2")).toBeInTheDocument();
  });

  it("renders the danger token triplet for a down state", () => {
    render(<StatusChip state={{ kind: "down", detail: "connection refused" }} label="Ollama" />);
    const chip = screen.getByText(/Ollama/).closest("span[aria-live]") as HTMLElement;
    expect(chip.className).toContain("bg-[var(--mem-status-danger-bg)]");
    expect(chip.className).toContain("text-[var(--mem-status-danger-text)]");
    expect(chip.className).toContain("border-[var(--mem-status-danger-border)]");
  });

  it("shows the not-verified i18n string for a stale state", () => {
    render(<StatusChip state={{ kind: "stale" }} label="Ollama" />);
    expect(screen.getByText("Ollama · Not verified yet")).toBeInTheDocument();
  });

  it("marks the container aria-live=polite and the dot aria-hidden", () => {
    const { container } = render(<StatusChip state={{ kind: "idle" }} label="Ollama" />);
    const chip = screen.getByText("Ollama").closest("span[aria-live]");
    expect(chip).toHaveAttribute("aria-live", "polite");
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });
});

describe("Field", () => {
  it("wires the control's aria-describedby to the description id", () => {
    render(
      <Field label="Endpoint" htmlFor="endpoint" description="Where the daemon listens">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Endpoint");
    expect(input).toHaveAttribute("aria-describedby", "endpoint-desc");
    expect(screen.getByText("Where the daemon listens")).toHaveAttribute("id", "endpoint-desc");
  });

  it("renders error text outside the <label> element and wins over description", () => {
    render(
      <Field label="Endpoint" htmlFor="endpoint" description="helper" error="Invalid host">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Endpoint");
    expect(input).toHaveAttribute("aria-describedby", "endpoint-error");
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("Invalid host");
    const label = screen.getByText("Endpoint");
    expect(label.tagName).toBe("LABEL");
    expect(label).not.toContainElement(errorEl);
    expect(screen.queryByText("helper")).not.toBeInTheDocument();
  });
});

describe("Toggle", () => {
  function ControlledToggle() {
    const [enabled, setEnabled] = useState(false);
    return <Toggle enabled={enabled} onToggle={() => setEnabled((e) => !e)} />;
  }

  it("reflects enabled via aria-pressed and flips it on click", async () => {
    const user = userEvent.setup();
    render(<ControlledToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Button", () => {
  it("disables the button when disabled is set", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("renders every variant", () => {
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    for (const variant of variants) {
      render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
    }
  });
});
