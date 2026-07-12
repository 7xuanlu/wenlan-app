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
  /** Provider-shaped example shown when no key is stored (§9.1). */
  keyPlaceholder?: string;
  /** Soft-check prefixes; absent = no format check (§9.1). */
  keyPrefixes?: string[];
  /** Provider console, opened in the system browser (§9.1). */
  getKeyUrl?: string;
}

// Spec §1 preset table. Every keyed preset's /models + /chat/completions
// compatibility is validated live during implementation (council dissent
// note); a preset whose /models shape drifts ships free-text-only (the card
// already falls back to free text when discovery fails, so no code change —
// just note the finding in the PR description).
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "sk-proj-...",
    keyPrefixes: ["sk-"],
    getKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    name: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "AIzaSy... or AQ....",
    keyPrefixes: ["AIzaSy", "AQ."],
    getKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "gsk_...",
    keyPrefixes: ["gsk_"],
    getKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "sk-or-v1-...",
    keyPrefixes: ["sk-or-"],
    getKeyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "mistral",
    name: "Mistral",
    endpoint: "https://api.mistral.ai/v1",
    keyRequired: true,
    group: "cloud",
    getKeyUrl: "https://console.mistral.ai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "sk-...",
    keyPrefixes: ["sk-"],
    getKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    endpoint: "https://api.x.ai/v1",
    keyRequired: true,
    group: "cloud",
    keyPlaceholder: "xai-...",
    keyPrefixes: ["xai-"],
    getKeyUrl: "https://console.x.ai",
  },
  { id: "ollama", name: "Ollama (local)", endpoint: "http://localhost:11434/v1", keyRequired: false, group: "local" },
  { id: "lmstudio", name: "LM Studio (local)", endpoint: "http://localhost:1234/v1", keyRequired: false, group: "local" },
  { id: "custom", name: "Custom…", endpoint: "", keyRequired: false, group: "custom" },
];

/** Normalize a hand-typed endpoint so equivalent forms resolve to the same
 *  probe target: default the scheme to http:// and the path to /v1 when
 *  absent. No further host validation — malformed input still falls
 *  through to free text/no-match, same as before this existed. */
export function normalizeEndpoint(raw: string): string {
  let ep = raw.trim().replace(/\/+$/, "");
  if (ep === "") return ep;
  if (!/^https?:\/\//.test(ep)) ep = `http://${ep}`;
  if (!/^https?:\/\/[^/]+\/.+/.test(ep)) ep = `${ep}/v1`;
  return ep;
}

const ENDPOINT_HOST_RE = /^(https?:\/\/)(\[[^\]]+\]|[^/:]+)(.*)$/;

/** localhost, 127.0.0.1, and [::1] are the same host for PRESET MATCHING
 *  only (Thread #2). Never used to rewrite the endpoint that actually gets
 *  probed — a server can bind IPv4-only while `localhost` resolves to ::1,
 *  so rewriting a user's typed host could break a probe that would
 *  otherwise have worked. See `endpointsMatch`. */
export function canonicalHostForMatch(host: string): string {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "127.0.0.1" || bare === "::1" ? "localhost" : host;
}

/** True when two already-normalized endpoints denote the same server for
 *  preset-matching purposes, treating localhost/127.0.0.1/[::1] as one
 *  host. Match-only: does not affect what gets fetched. */
export function endpointsMatch(a: string, b: string): boolean {
  const canon = (ep: string) => {
    const m = ENDPOINT_HOST_RE.exec(ep);
    if (!m) return ep;
    const [, scheme, host, rest] = m;
    return `${scheme}${canonicalHostForMatch(host)}${rest}`;
  };
  return canon(a) === canon(b);
}

/** Match a saved endpoint back to its preset ("custom" when no match). */
export function presetForEndpoint(endpoint: string | null): ProviderPreset {
  const norm = normalizeEndpoint(endpoint ?? "");
  return (
    PROVIDER_PRESETS.find((p) => p.endpoint !== "" && endpointsMatch(normalizeEndpoint(p.endpoint), norm)) ??
    PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
  );
}

// Group render order for the widened (§5.2a) preset picker: local servers
// first, then cloud vendors, then the free-text "Custom…" escape hatch last.
const VISIBLE_GROUP_ORDER: PresetGroup[] = ["local", "cloud", "custom"];

/** The presets AnyProviderCard should render (§5.2a). Below the daemon-0.13
 *  key-auth floor, only the no-key-required presets appear — same set and
 *  order as before cloud vendors existed. At/above the floor, every preset
 *  appears, grouped local-first / cloud-second / custom-last. */
export function visiblePresets(supportsExternalKey: boolean): ProviderPreset[] {
  if (!supportsExternalKey) {
    return PROVIDER_PRESETS.filter((p) => !p.keyRequired);
  }
  return VISIBLE_GROUP_ORDER.flatMap((group) => PROVIDER_PRESETS.filter((p) => p.group === group));
}

/** Soft key-format check (§9.1): true only when a non-empty key matches none
 *  of the preset's prefixes. Presets without prefixes (e.g. Mistral) never
 *  mismatch. Never used to block Save/Test — hint only. */
export function keyPrefixMismatch(preset: ProviderPreset, key: string): boolean {
  const k = key.trim();
  if (k === "" || !preset.keyPrefixes || preset.keyPrefixes.length === 0) return false;
  return !preset.keyPrefixes.some((prefix) => k.startsWith(prefix));
}
