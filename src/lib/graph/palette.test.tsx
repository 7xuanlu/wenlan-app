// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import {
  slotForEntityType,
  useGraphPalette,
  colorForEntityType,
  type GraphPalette,
} from "./palette";

const KG_TOKENS = ["project", "tool", "org", "person", "concept", "neutral", "edge", "edge-strong"];

function setToken(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  for (const token of KG_TOKENS) document.documentElement.style.removeProperty(`--kg-${token}`);
});

function Probe() {
  const palette = useGraphPalette();
  return <div data-testid="project">{palette.project}</div>;
}

describe("slotForEntityType", () => {
  it("maps the five validated daemon types to their slots", () => {
    expect(slotForEntityType("project")).toBe("project");
    expect(slotForEntityType("technology")).toBe("tool");
    expect(slotForEntityType("organization")).toBe("org");
    expect(slotForEntityType("person")).toBe("person");
    expect(slotForEntityType("concept")).toBe("concept");
  });

  it("maps place, event, and unknown types to neutral", () => {
    expect(slotForEntityType("place")).toBe("neutral");
    expect(slotForEntityType("event")).toBe("neutral");
    expect(slotForEntityType("wildcard")).toBe("neutral");
  });
});

describe("useGraphPalette", () => {
  it("reads the --kg-* tokens synchronously on mount", () => {
    setToken("--kg-project", "#111111");
    render(<Probe />);
    expect(screen.getByTestId("project")).toHaveTextContent("#111111");
  });

  it("re-reads the tokens when data-theme flips on <html>", async () => {
    setToken("--kg-project", "#111111");
    render(<Probe />);
    expect(screen.getByTestId("project")).toHaveTextContent("#111111");

    act(() => {
      setToken("--kg-project", "#222222");
      document.documentElement.setAttribute("data-theme", "light");
    });

    await waitFor(() =>
      expect(screen.getByTestId("project")).toHaveTextContent("#222222"),
    );
  });
});

describe("colorForEntityType", () => {
  it("resolves an entity type through its slot to a palette color", () => {
    const palette: GraphPalette = {
      project: "#proj",
      tool: "#tool",
      org: "#org",
      person: "#person",
      concept: "#concept",
      neutral: "#neutral",
      edge: "#edge",
      edgeStrong: "#edgeStrong",
      label: "#label",
    };
    expect(colorForEntityType("technology", palette)).toBe("#tool");
    expect(colorForEntityType("place", palette)).toBe("#neutral");
  });
});
