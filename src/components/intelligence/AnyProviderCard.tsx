// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
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
import {
  PROVIDER_PRESETS,
  presetForEndpoint,
  keyPrefixMismatch,
  type PresetGroup,
} from "./providerPresets";

interface Props {
  /** Filter the preset picker (wizard: cloud-only / local-only). */
  groups?: PresetGroup[];
  initialPresetId?: string;
  hidePresetPicker?: boolean;
}

const OLLAMA_ENDPOINT = "http://localhost:11434/v1";
const LMSTUDIO_ENDPOINT = "http://localhost:1234/v1";
const hostOf = (ep: string) => ep.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const localLabel = (name: string) => name.replace(/\s*\(local\)$/i, "");

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid var(--mem-border)",
  backgroundColor: "var(--mem-bg)",
  color: "var(--mem-text)",
  fontFamily: "var(--mem-font-mono)",
  fontSize: "12px",
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--mem-font-body)",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--mem-text-secondary)",
};

export default function AnyProviderCard({ groups, initialPresetId, hidePresetPicker }: Props) {
  const { t } = useTranslation();
  const { supportsExternalKey, supportsHotSwap } = useDaemonVersion();
  const anthropic = useApiKeyStatus();
  const queryClient = useQueryClient();
  const keyHintId = useId();

  const presets = useMemo(
    () =>
      PROVIDER_PRESETS.filter(
        (p) => !groups || groups.includes(p.group) || p.group === "custom"
      ),
    [groups]
  );

  const isLocalOnly = groups?.length === 1 && groups[0] === "local";

  const [presetId, setPresetId] = useState(initialPresetId ?? presets[0].id);
  const preset = presets.find((p) => p.id === presetId) ?? presets[presets.length - 1];
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

  // Keyed cloud presets stay dark below daemon 0.13 (spec §8).
  const lockedByVersion = preset.keyRequired && !supportsExternalKey;

  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
  const endpointValid = /^https?:\/\//.test(trimmedEndpoint);

  // Model auto-discovery; silent fallback to free text on failure (spec §1).
  const discovery = useQuery({
    queryKey: ["external-models", trimmedEndpoint, apiKey],
    queryFn: () => listExternalModels(trimmedEndpoint, apiKey || null),
    enabled: endpointValid && !lockedByVersion && !isLocalOnly,
    retry: false,
    staleTime: 30_000,
  });
  const models = discovery.data ?? [];

  // §9.2: probe BOTH local servers on the Local-server pane mount.
  const ollamaProbe = useQuery({
    queryKey: ["local-probe", OLLAMA_ENDPOINT],
    queryFn: () => listExternalModels(OLLAMA_ENDPOINT, null),
    enabled: !!isLocalOnly,
    retry: false,
    staleTime: 30_000,
  });
  const lmStudioProbe = useQuery({
    queryKey: ["local-probe", LMSTUDIO_ENDPOINT],
    queryFn: () => listExternalModels(LMSTUDIO_ENDPOINT, null),
    enabled: !!isLocalOnly,
    retry: false,
    staleTime: 30_000,
  });
  const probeFor = (id: string) =>
    id === "ollama" ? ollamaProbe : id === "lmstudio" ? lmStudioProbe : null;
  const selectedProbe = probeFor(presetId);
  const localModels = selectedProbe?.data ?? [];

  // Auto-select the single responder, once both probes have settled.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!isLocalOnly || autoSelectedRef.current) return;
    if (ollamaProbe.isLoading || lmStudioProbe.isLoading) return;
    autoSelectedRef.current = true; // decide exactly once
    // Respect a previously-saved local endpoint over auto-selection.
    if (current && current[0]) return;
    const up = [
      ["ollama", ollamaProbe.isSuccess] as const,
      ["lmstudio", lmStudioProbe.isSuccess] as const,
    ].filter(([, ok]) => ok);
    if (up.length === 1) {
      const id = up[0][0];
      setPresetId(id);
      setEndpoint(id === "ollama" ? OLLAMA_ENDPOINT : LMSTUDIO_ENDPOINT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalOnly, ollamaProbe.isLoading, ollamaProbe.isSuccess, lmStudioProbe.isLoading, lmStudioProbe.isSuccess]);

  const selectPreset = (id: string) => {
    setPresetId(id);
    const next = PROVIDER_PRESETS.find((p) => p.id === id);
    if (next && next.endpoint) setEndpoint(next.endpoint);
    if (next && !next.endpoint) setEndpoint("");
    setModel("");
    setApiKey("");
    setTestState({ kind: "idle" });
    setSaveState("idle");
  };

  const keyToSend = (): string | undefined =>
    supportsExternalKey && apiKey !== "" ? apiKey : undefined;

  const handleTest = async () => {
    setTestState({ kind: "testing" });
    try {
      const resp = await testExternalLlm(trimmedEndpoint, model, keyToSend() ?? null);
      setTestState({ kind: "ok", response: resp.response });
    } catch (err) {
      // Verbatim daemon error (spec: Error handling).
      setTestState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSave = async () => {
    setSaveState("saving");
    try {
      await setExternalLlm(trimmedEndpoint, model, keyToSend());
      setSaveState(supportsHotSwap ? "applied" : "restart");
      // The daemon may hot-load this config immediately (spec §7.6), so the
      // strip's status queries must refresh alongside our own prefill query —
      // otherwise ActiveIntelligenceStrip keeps showing stale state.
      queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      queryClient.invalidateQueries({ queryKey: ["external-llm"] });
      queryClient.invalidateQueries({ queryKey: ["external-llm-key-configured"] });
    } catch (err) {
      setSaveState(`error:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const canAct = endpointValid && model.trim() !== "" && !lockedByVersion;

  return (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ border: "1px solid var(--mem-border)", backgroundColor: "var(--mem-surface)", gap: "12px" }}
    >
      <div>
        <h3 style={{ fontFamily: "var(--mem-font-heading)", fontSize: "15px", fontWeight: 500, color: "var(--mem-text)" }}>
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

      {isLocalOnly ? (
        <>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const probe = probeFor(p.id);
              const status = !probe
                ? null
                : probe.isLoading
                ? "probing"
                : probe.isSuccess
                ? "connected"
                : "notDetected";
              const dot = status === "connected" ? "●" : status === "notDetected" ? "○" : "…";
              const selected = p.id === presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPreset(p.id)}
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
                      style={{
                        marginRight: "6px",
                        color:
                          status === "connected" && !selected
                            ? "var(--mem-accent-sage)"
                            : "inherit",
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
          {selectedProbe && (
            <p
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "12px",
                lineHeight: 1.5,
                color: selectedProbe.isSuccess
                  ? "var(--mem-accent-sage)"
                  : "var(--mem-text-secondary)",
              }}
            >
              {selectedProbe.isLoading
                ? t("externalProvider.localProbing", { name: localLabel(preset.name) })
                : selectedProbe.isSuccess
                ? t("externalProvider.localConnectedChip", {
                    name: localLabel(preset.name),
                    modelCount: localModels.length,
                  })
                : t("externalProvider.localNotDetectedChip", {
                    name: localLabel(preset.name),
                    host: hostOf(preset.endpoint),
                  })}
            </p>
          )}
        </>
      ) : !hidePresetPicker ? (
        <label className="flex flex-col gap-1">
          <span style={labelStyle}>{t("externalProvider.presetLabel")}</span>
          <select value={presetId} onChange={(e) => selectPreset(e.target.value)} style={fieldStyle}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {lockedByVersion ? (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", lineHeight: 1.5 }}>
          {t("externalProvider.keyNeedsUpgrade")}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span style={labelStyle}>{t("externalProvider.endpointLabel")}</span>
            <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} style={fieldStyle} />
          </label>

          <label className="flex flex-col gap-1">
            <span style={labelStyle}>{t("externalProvider.modelLabel")}</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("externalProvider.modelPlaceholder")}
              list="any-provider-models"
              style={fieldStyle}
            />
            <datalist id="any-provider-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {discovery.isError && (
            <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
              {t("externalProvider.modelDiscoveryFailed")}
            </span>
          )}

          {supportsExternalKey && (
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span style={labelStyle}>{t("externalProvider.apiKeyLabel")}</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    keyConfigured
                      ? t("externalProvider.apiKeyConfiguredPlaceholder")
                      : (preset.keyPlaceholder ?? "")
                  }
                  style={fieldStyle}
                  aria-describedby={keyPrefixMismatch(preset, apiKey) ? keyHintId : undefined}
                />
              </label>
              {keyPrefixMismatch(preset, apiKey) && (
                <span
                  id={keyHintId}
                  style={{
                    fontFamily: "var(--mem-font-body)",
                    fontSize: "11px",
                    color: "var(--mem-accent-amber)",
                  }}
                >
                  {t("externalProvider.keyHint", {
                    vendor: preset.name,
                    prefix: (preset.keyPrefixes ?? []).join(" or "),
                  })}
                </span>
              )}
              {preset.getKeyUrl && (
                <button
                  type="button"
                  onClick={() => shellOpen(preset.getKeyUrl!)}
                  className="self-start text-xs"
                  style={{
                    fontFamily: "var(--mem-font-body)",
                    color: "var(--mem-accent-indigo)",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  {t("externalProvider.getKeyLink")}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={!canAct || testState.kind === "testing"}
          className="rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ border: "1px solid var(--mem-border)", color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}
        >
          {testState.kind === "testing" ? t("externalProvider.testing") : t("externalProvider.test")}
        </button>
        <button
          onClick={handleSave}
          disabled={!canAct || saveState === "saving"}
          className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--mem-accent-indigo)", color: "white", fontFamily: "var(--mem-font-body)" }}
        >
          {saveState === "saving" ? t("externalProvider.saving") : t("externalProvider.save")}
        </button>
      </div>

      {testState.kind === "ok" && (
        <p style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", color: "var(--mem-text-secondary)" }}>
          {t("externalProvider.testOk", { response: testState.response })}
        </p>
      )}
      {testState.kind === "error" && (
        <p className="text-red-500" style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px" }}>
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
        <p className="text-red-500" style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px" }}>
          {saveState.slice("error:".length)}
        </p>
      )}
    </div>
  );
}
