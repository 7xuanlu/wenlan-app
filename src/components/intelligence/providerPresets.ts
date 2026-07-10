// SPDX-License-Identifier: AGPL-3.0-only

export type PresetGroup = "cloud" | "local" | "custom";

/** Anthropic isn't an AnyProviderCard preset — it has native handling via
 *  ApiKeyCard — but the wizard's cloud-pane vendor pill still needs this
 *  untranslated proper noun (same convention as ProviderPreset.name below). */
export const ANTHROPIC_VENDOR_NAME = "Anthropic";

export interface ProviderPreset {
  id: string;
  /** Vendor names are proper nouns — not translated. */
  name: string;
  endpoint: string;
  keyRequired: boolean;
  group: PresetGroup;
}

// Spec §1 preset table. Every keyed preset's /models + /chat/completions
// compatibility is validated live during implementation (council dissent
// note); a preset whose /models shape drifts ships free-text-only (the card
// already falls back to free text when discovery fails, so no code change —
// just note the finding in the PR description).
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", keyRequired: true, group: "cloud" },
  { id: "gemini", name: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", keyRequired: true, group: "cloud" },
  { id: "groq", name: "Groq", endpoint: "https://api.groq.com/openai/v1", keyRequired: true, group: "cloud" },
  { id: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", keyRequired: true, group: "cloud" },
  { id: "mistral", name: "Mistral", endpoint: "https://api.mistral.ai/v1", keyRequired: true, group: "cloud" },
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", keyRequired: true, group: "cloud" },
  { id: "xai", name: "xAI", endpoint: "https://api.x.ai/v1", keyRequired: true, group: "cloud" },
  { id: "ollama", name: "Ollama (local)", endpoint: "http://localhost:11434/v1", keyRequired: false, group: "local" },
  { id: "lmstudio", name: "LM Studio (local)", endpoint: "http://localhost:1234/v1", keyRequired: false, group: "local" },
  { id: "custom", name: "Custom…", endpoint: "", keyRequired: false, group: "custom" },
];

/** Match a saved endpoint back to its preset ("custom" when no match). */
export function presetForEndpoint(endpoint: string | null): ProviderPreset {
  const norm = (endpoint ?? "").replace(/\/+$/, "");
  return (
    PROVIDER_PRESETS.find((p) => p.endpoint !== "" && p.endpoint === norm) ??
    PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
  );
}
