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

// Standing rule: never announce that Wenlan itself is a plugin. The only
// exceptions are real CLI commands/slash-commands and claude.ai's own menu
// names, referenced verbatim while walking the user through its UI.
function flattenStringEntries(
  value: unknown,
  prefix = "",
): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) =>
      flattenStringEntries(child, prefix ? `${prefix}.${key}` : key),
  );
}

const PLUGIN_WORD_ALLOWLIST = new Set([
  "connectMatrix.claudeCodeCommand1",
  "connectMatrix.claudeCodeCommand2",
  "connectMatrix.claudeCodeReload",
  "connectMatrix.claudeCodePrompt", // real `/plugin` menu + `claude plugin` CLI commands
  "connectMatrix.claudePluginStep1",
  "connectMatrix.claudePluginStep2",
  "connectMatrix.claudePluginStep3",
]);
const BANNED_PLUGIN_WORDS = ["plugin", "插件", "外掛"];

describe("banned self-referential 'plugin' copy", () => {
  it.each(supportedAppLocales)(
    "%s never describes Wenlan itself as a plugin",
    (locale) => {
      const entries = flattenStringEntries(resources[locale].translation);
      const offenders = entries.filter(
        ([key, value]) =>
          !PLUGIN_WORD_ALLOWLIST.has(key) &&
          BANNED_PLUGIN_WORDS.some((word) => value.includes(word)),
      );
      expect(offenders).toEqual([]);
    },
  );
});
