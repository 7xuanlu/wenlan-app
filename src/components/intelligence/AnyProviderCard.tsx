// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  type PresetGroup,
} from "./providerPresets";

interface Props {
  /** Filter the preset picker (wizard: cloud-only / local-only). */
  groups?: PresetGroup[];
  initialPresetId?: string;
  hidePresetPicker?: boolean;
}

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

  const presets = useMemo(
    () =>
      PROVIDER_PRESETS.filter(
        (p) => !groups || groups.includes(p.group) || p.group === "custom"
      ),
    [groups]
  );

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
    enabled: endpointValid && !lockedByVersion,
    retry: false,
    staleTime: 30_000,
  });
  const models = discovery.data ?? [];

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

      {!hidePresetPicker && (
        <label className="flex flex-col gap-1">
          <span style={labelStyle}>{t("externalProvider.presetLabel")}</span>
          <select value={presetId} onChange={(e) => selectPreset(e.target.value)} style={fieldStyle}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}

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
            <label className="flex flex-col gap-1">
              <span style={labelStyle}>{t("externalProvider.apiKeyLabel")}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyConfigured ? t("externalProvider.apiKeyConfiguredPlaceholder") : ""}
                style={fieldStyle}
              />
            </label>
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
