import { describe, expect, it } from "vitest";

import { resources, supportedAppLocales } from "./resources";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("translation resources", () => {
  it("defines the supported app locales in a stable order", () => {
    expect(supportedAppLocales).toEqual(["en", "zh-Hans", "zh-Hant"]);
  });

  it("contains representative primary interface keys", () => {
    expect(resources.en.translation.setup.welcomeTitle).toBe(
      "Welcome to Wenlan",
    );
    expect(resources.en.translation.main.searchPlaceholder).toBe(
      "Search pages, entities, sources...",
    );
    expect(resources.en.translation.settings.language.label).toBe("Language");
  });

  it("keeps Simplified and Traditional Chinese key sets in parity with English", () => {
    const englishKeys = flattenKeys(resources.en.translation).sort();

    expect(flattenKeys(resources["zh-Hans"].translation).sort()).toEqual(
      englishKeys,
    );
    expect(flattenKeys(resources["zh-Hant"].translation).sort()).toEqual(
      englishKeys,
    );
  });
});
