// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";

export type GraphSlot =
  | "project"
  | "tool"
  | "org"
  | "person"
  | "concept"
  | "neutral";

// Daemon entity vocabulary → validated 5-slot palette. place, event, and any
// unknown type take neutral: the 5-slot set clears the dataviz validator
// (ΔE 11.6 normal / 1.6 deutan), whereas 7-slot candidates that colored
// place/event failed it. Do not extend this to 7 without re-validating.
export function slotForEntityType(entityType: string): GraphSlot {
  switch (entityType) {
    case "project":
      return "project";
    case "technology":
      return "tool";
    case "organization":
      return "org";
    case "person":
      return "person";
    case "concept":
      return "concept";
    default:
      return "neutral";
  }
}

export interface GraphPalette {
  project: string;
  tool: string;
  org: string;
  person: string;
  concept: string;
  neutral: string;
  edge: string;
  edgeStrong: string;
  /** Label ink — reads the shared --mem-text token, not a --kg-* slot. */
  label: string;
}

// Read the resolved --kg-* custom properties off <html>. getComputedStyle
// resolves them through the cascade (index.css theme blocks), so this returns
// the values for whichever theme is currently active.
function readPalette(): GraphPalette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    project: read("--kg-project"),
    tool: read("--kg-tool"),
    org: read("--kg-org"),
    person: read("--kg-person"),
    concept: read("--kg-concept"),
    neutral: read("--kg-neutral"),
    edge: read("--kg-edge"),
    edgeStrong: read("--kg-edge-strong"),
    label: read("--mem-text"),
  };
}

/**
 * Graph colors as React state, re-read whenever the theme flips. The theme
 * switch stamps data-theme on <html>; a MutationObserver on that attribute
 * triggers the re-read. Never read tokens inside a paint callback — read here,
 * pass the resolved values down.
 */
export function useGraphPalette(): GraphPalette {
  const [palette, setPalette] = useState<GraphPalette>(readPalette);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}

/** Slot color for an entity type, resolved against the current palette. */
export function colorForEntityType(entityType: string, palette: GraphPalette): string {
  return palette[slotForEntityType(entityType)];
}
