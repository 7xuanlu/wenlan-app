// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  getExternalLlm,
  setExternalLlm,
  testExternalLlm,
  listExternalModels,
  getExternalLlmKeyConfigured,
} from "../../lib/tauri";
import { useDaemonVersion } from "../../hooks/useDaemonVersion";
import { useApiKeyStatus } from "./IntelligenceSetup";
import { PROVIDER_PRESETS, presetForEndpoint, normalizeEndpoint, keyPrefixMismatch } from "./providerPresets";
import { Card, Field, Input, Button, StatusChip, type ProbeState } from "../memory/settings/primitives";

// The Local-server card (spec §5.2): only presets that need no key. Widening
// to all of PROVIDER_PRESETS — with a key Field appearing per preset.keyRequired,
// already wired below — is the entire §5.2a forward-compat diff.
const LOCAL_PRESETS = PROVIDER_PRESETS.filter((p) => !p.keyRequired);

// The preset table is the single source of truth for local endpoints — look
// them up by id rather than restating the URLs here, so a future table edit
// can't drift the probed endpoint away from the host shown in the UI.
function presetEndpoint(id: string): string {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset id: ${id}`);
  return preset.endpoint;
}
const OLLAMA_ENDPOINT = presetEndpoint("ollama");
const LMSTUDIO_ENDPOINT = presetEndpoint("lmstudio");
const hostOf = (ep: string) => ep.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const localLabel = (name: string) => name.replace(/\s*\(local\)$/i, "");

const selectClassName =
  "h-[32px] px-[10px] py-[8px] rounded-[var(--mem-radius-md)] bg-[var(--mem-bg)] outline-none " +
  "border border-[var(--mem-border)] text-[var(--mem-text)] transition-[border-color] " +
  "duration-[var(--mem-dur-fast)] focus-visible:border-[var(--mem-accent-indigo)] " +
  "focus-visible:outline-2 focus-visible:outline-[var(--mem-focus-ring)] focus-visible:outline-offset-0";

export default function AnyProviderCard() {
  const { t } = useTranslation();
  const { supportsHotSwap } = useDaemonVersion();
  const anthropic = useApiKeyStatus();
  const queryClient = useQueryClient();

  const [presetId, setPresetId] = useState(LOCAL_PRESETS[0].id);
  const preset = LOCAL_PRESETS.find((p) => p.id === presetId) ?? LOCAL_PRESETS[LOCAL_PRESETS.length - 1];
  const [endpoint, setEndpoint] = useState(preset.endpoint);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "ok"; response: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "applied" | "restart" | `error:${string}`
  >("idle");

  // Prefill from the daemon's current external slot.
  const { data: current } = useQuery({ queryKey: ["external-llm"], queryFn: getExternalLlm });
  const { data: keyConfigured } = useQuery({
    queryKey: ["external-llm-key-configured"],
    queryFn: getExternalLlmKeyConfigured,
  });
  useEffect(() => {
    if (!current) return;
    const [savedEndpoint, savedModel] = current;
    if (savedEndpoint) {
      setEndpoint(savedEndpoint);
      setPresetId(presetForEndpoint(savedEndpoint).id);
    }
    if (savedModel) setModel(savedModel);
    // Run once when the saved config arrives; later edits are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const trimmedEndpoint = normalizeEndpoint(endpoint);
  const endpointValid = /^https?:\/\//.test(trimmedEndpoint);

  // §9.2: probe BOTH local servers on pane mount.
  const ollamaProbe = useQuery({
    queryKey: ["local-probe", OLLAMA_ENDPOINT],
    queryFn: () => listExternalModels(OLLAMA_ENDPOINT, null),
    retry: false,
    staleTime: 30_000,
  });
  const lmStudioProbe = useQuery({
    queryKey: ["local-probe", LMSTUDIO_ENDPOINT],
    queryFn: () => listExternalModels(LMSTUDIO_ENDPOINT, null),
    retry: false,
    staleTime: 30_000,
  });
  const probeFor = (id: string) =>
    id === "ollama" ? ollamaProbe : id === "lmstudio" ? lmStudioProbe : null;
  // A probe is only "the" probe for the selected preset while the live
  // (trimmed) endpoint still matches that preset's endpoint — once the user
  // hand-edits Endpoint away from e.g. Ollama's default, the probed models
  // belong to a different server than the one now in the field, so the
  // association must drop (chip-never-lies: never show a stale chip or a
  // dropdown of the wrong server's models).
  const probedEndpointFor = (id: string) =>
    id === "ollama" ? OLLAMA_ENDPOINT : id === "lmstudio" ? LMSTUDIO_ENDPOINT : null;
  const selectedProbe =
    probedEndpointFor(presetId) === trimmedEndpoint ? probeFor(presetId) : null;

  // Model auto-discovery; silent fallback to free text on failure. Ollama/LM
  // Studio already have a dedicated probe above — reusing this query for them
  // would duplicate the fetch, so it stays off whenever their probe is the
  // active one. A hand-typed or "Custom…" endpoint has no dedicated probe, so
  // this query is the only discovery source for it.
  const discovery = useQuery({
    queryKey: ["external-models", trimmedEndpoint, apiKey],
    queryFn: () => listExternalModels(trimmedEndpoint, apiKey || null),
    enabled: endpointValid && !selectedProbe,
    retry: false,
    staleTime: 30_000,
  });
  const models = discovery.data ?? [];
  const localQuery = selectedProbe;
  const localQueryModels = localQuery?.data ?? [];

  // Auto-select the single responder, once both probes have settled.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (ollamaProbe.isLoading || lmStudioProbe.isLoading) return;
    // Wait for the saved-config query to settle before latching a decision —
    // otherwise a fast probe can auto-select while `current` is still
    // undefined, and the prefill effect then re-applies the saved endpoint
    // right after, causing a visible double-set of the endpoint field.
    if (current === undefined) return;
    autoSelectedRef.current = true; // decide exactly once
    // Respect a previously-saved local endpoint over auto-selection.
    if (current[0]) return;
    const up = [
      ["ollama", ollamaProbe.isSuccess] as const,
      ["lmstudio", lmStudioProbe.isSuccess] as const,
    ].filter(([, ok]) => ok);
    if (up.length === 1) {
      const id = up[0][0];
      setPresetId(id);
      setEndpoint(id === "ollama" ? OLLAMA_ENDPOINT : LMSTUDIO_ENDPOINT);
    }
  }, [
    ollamaProbe.isLoading,
    ollamaProbe.isSuccess,
    lmStudioProbe.isLoading,
    lmStudioProbe.isSuccess,
    current,
  ]);

  const selectPreset = (id: string) => {
    setPresetId(id);
    const next = LOCAL_PRESETS.find((p) => p.id === id);
    if (next && next.endpoint) setEndpoint(next.endpoint);
    if (next && !next.endpoint) setEndpoint("");
    setModel("");
    setApiKey("");
    setTestState({ kind: "idle" });
    setSaveState("idle");
  };

  const keyToSend = (): string | undefined => (apiKey !== "" ? apiKey : undefined);

  const handleTest = async () => {
    setTestState({ kind: "testing" });
    try {
      const resp = await testExternalLlm(trimmedEndpoint, model, keyToSend() ?? null);
      setTestState({ kind: "ok", response: resp.response });
    } catch (err) {
      // Verbatim daemon error.
      setTestState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSave = async () => {
    setSaveState("saving");
    try {
      await setExternalLlm(trimmedEndpoint, model, keyToSend());
      setSaveState(supportsHotSwap ? "applied" : "restart");
      // The daemon may hot-load this config immediately, so the strip's
      // status queries must refresh alongside our own prefill query —
      // otherwise ActiveIntelligenceStrip keeps showing stale state.
      queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      queryClient.invalidateQueries({ queryKey: ["external-llm"] });
      queryClient.invalidateQueries({ queryKey: ["external-llm-key-configured"] });
    } catch (err) {
      setSaveState(`error:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const canAct = endpointValid && model.trim() !== "";

  const chipState: ProbeState | null = !localQuery
    ? null
    : localQuery.isLoading
      ? { kind: "probing" }
      : localQuery.isSuccess
        ? { kind: "up" }
        : { kind: "down" };
  const chipLabel = !localQuery
    ? ""
    : localQuery.isLoading
      ? t("externalProvider.localProbing", { name: localLabel(preset.name) })
      : localQuery.isSuccess
        ? t("externalProvider.localConnectedChip", {
            name: localLabel(preset.name),
            count: localQueryModels.length,
          })
        : t("externalProvider.localNotDetectedChip", {
            name: localLabel(preset.name),
            host: hostOf(preset.endpoint),
          });

  return (
    <Card padding="card">
      <div className="flex flex-col" style={{ gap: "12px" }}>
        <div>
          <h3
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-lg)",
              fontWeight: 600,
              color: "var(--mem-text)",
            }}
          >
            {t("externalProvider.title")}
          </h3>
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", lineHeight: 1.5, marginTop: "4px" }}>
            {t("externalProvider.description")}
          </p>
        </div>

        {anthropic.isConfigured && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-accent-amber)", lineHeight: 1.5 }}>
            {t("externalProvider.anthropicPrecedence")}
          </p>
        )}

        <div className="flex flex-wrap gap-2" role="group" aria-label={t("externalProvider.presetLabel")}>
          {LOCAL_PRESETS.map((p) => {
            const probe = probeFor(p.id);
            const status = !probe ? null : probe.isLoading ? "probing" : probe.isSuccess ? "connected" : "notDetected";
            const dot = status === "connected" ? "●" : status === "notDetected" ? "○" : "…";
            const selected = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPreset(p.id)}
                aria-pressed={selected}
                className="rounded-full px-3 py-1.5 text-xs"
                style={{
                  border: `1px solid ${selected ? "var(--mem-accent-indigo)" : "var(--mem-border)"}`,
                  backgroundColor: selected ? "var(--mem-accent-indigo)" : "var(--mem-surface)",
                  color: selected ? "white" : "var(--mem-text)",
                  fontFamily: "var(--mem-font-body)",
                }}
              >
                {probe && (
                  <span
                    aria-hidden="true"
                    style={{
                      marginRight: "6px",
                      color: status === "connected" && !selected ? "var(--mem-accent-sage)" : "inherit",
                    }}
                  >
                    {dot}
                  </span>
                )}
                {localLabel(p.name)}
              </button>
            );
          })}
        </div>

        {chipState && <StatusChip state={chipState} label={chipLabel} />}

        <Field label={t("externalProvider.endpointLabel")} htmlFor="any-provider-endpoint">
          <Input mono value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        </Field>

        <Field label={t("externalProvider.modelLabel")} htmlFor="any-provider-model">
          {localQuery && localQueryModels.length >= 1 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={selectClassName}
              style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)" }}
            >
              <option value="">{t("externalProvider.modelSelectPlaceholder")}</option>
              {/* A saved model that's no longer among the discovered ids
                  (e.g. removed from Ollama since it was saved) must still
                  render as the visibly-selected value — never a blank select
                  while Save/Test remain enabled on a value the user can't see. */}
              {model !== "" && !localQueryModels.includes(model) && <option value={model}>{model}</option>}
              {localQueryModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <Input
              mono
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("externalProvider.modelPlaceholder")}
              list="any-provider-models"
            />
          )}
        </Field>
        {!(localQuery && localQueryModels.length >= 1) && (
          <datalist id="any-provider-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
        {(discovery.isError || localQuery?.isError) && (
          <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
            {t("externalProvider.modelDiscoveryFailed")}
          </span>
        )}

        {preset.keyRequired && (
          <Field
            label={t("externalProvider.apiKeyLabel")}
            htmlFor="any-provider-key"
            description={keyPrefixMismatch(preset, apiKey)
              ? t("externalProvider.keyHint", { vendor: preset.name, prefix: (preset.keyPrefixes ?? []).join(" or ") })
              : undefined}
          >
            <Input
              type="password"
              mono
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyConfigured ? t("externalProvider.apiKeyConfiguredPlaceholder") : preset.keyPlaceholder ?? ""}
            />
          </Field>
        )}
        {preset.keyRequired && preset.getKeyUrl && (
          <Button variant="ghost" size="sm" onClick={() => shellOpen(preset.getKeyUrl!)} className="self-start">
            {t("externalProvider.getKeyLink")}
          </Button>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTest}
            disabled={!canAct}
            loading={testState.kind === "testing"}
          >
            {t("externalProvider.test")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!canAct}
            loading={saveState === "saving"}
          >
            {t("externalProvider.save")}
          </Button>
        </div>

        {testState.kind === "ok" && (
          <p style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", color: "var(--mem-text-secondary)" }}>
            {t("externalProvider.testOk", { response: testState.response })}
          </p>
        )}
        {testState.kind === "error" && (
          <p style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", color: "var(--mem-status-danger-text)" }}>
            {testState.message}
          </p>
        )}
        {saveState === "applied" && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-accent-sage)" }}>
            {t("externalProvider.savedApplied")}
          </p>
        )}
        {saveState === "restart" && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)" }}>
            {t("externalProvider.savedRestart")}
          </p>
        )}
        {saveState.startsWith("error:") && (
          <p style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", color: "var(--mem-status-danger-text)" }}>
            {saveState.slice("error:".length)}
          </p>
        )}
      </div>
    </Card>
  );
}
