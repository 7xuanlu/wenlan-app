import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  downloadOnDeviceModel,
  getApiKey,
  getModelChoice,
  getOnDeviceModel,
  getSystemInfo,
  setApiKey,
  setModelChoice,
} from "../../lib/tauri";
import { Card, Field, Input, Button, Select, StatusChip } from "../memory/settings/primitives";

type AnthropicModelDescriptionKey =
  | "intelligence.modelDescriptions.fastAffordable"
  | "intelligence.modelDescriptions.balancedQuality"
  | "intelligence.modelDescriptions.maximumQuality";

export const ANTHROPIC_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", descKey: "intelligence.modelDescriptions.fastAffordable" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", descKey: "intelligence.modelDescriptions.balancedQuality" },
  { id: "claude-opus-4-6", label: "Opus 4.6", descKey: "intelligence.modelDescriptions.maximumQuality" },
] satisfies Array<{
  id: string;
  label: string;
  descKey: AnthropicModelDescriptionKey;
}>;

export function useApiKeyStatus() {
  const { data: maskedKey } = useQuery({
    queryKey: ["apiKey"],
    queryFn: getApiKey,
  });

  return {
    maskedKey,
    isConfigured: !!maskedKey,
  };
}

export function ApiKeyCard({
  showModelChoice = true,
  showNoKeyGuidance = true,
}: {
  showModelChoice?: boolean;
  showNoKeyGuidance?: boolean;
}) {
  const { t } = useTranslation();
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { maskedKey, isConfigured } = useApiKeyStatus();

  // A save/clear here changes what the daemon is actually serving (the
  // Anthropic key is hot-loaded even on 0.12), so the strip's status
  // queries must be invalidated alongside the key itself — otherwise
  // ActiveIntelligenceStrip keeps showing stale state until remount.
  const invalidateIntelligenceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["apiKey"] });
    queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    queryClient.invalidateQueries({ queryKey: ["external-llm"] });
    queryClient.invalidateQueries({ queryKey: ["external-llm-key-configured"] });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await setApiKey(keyInput);
      setKeyInput("");
      invalidateIntelligenceQueries();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await setApiKey("");
      invalidateIntelligenceQueries();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="card">
      <div className="flex flex-col" style={{ gap: "10px" }}>
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-lg)", fontWeight: 600, color: "var(--mem-text)" }}>
            {t("intelligence.apiKeyTitle")}
          </h3>
          <StatusChip
            state={isConfigured ? { kind: "up" } : { kind: "idle" }}
            label={isConfigured ? t("intelligence.connected") : t("intelligence.notConfigured")}
          />
        </div>
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
          {t("intelligence.apiKeyDescription")}
        </p>

        {isConfigured ? (
          <div className="flex items-center gap-2">
            <span
              className="flex-1 px-3 py-1.5 rounded-md"
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: "12px",
                color: "var(--mem-text-secondary)",
                backgroundColor: "var(--mem-hover)",
              }}
            >
              {maskedKey}
            </span>
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={saving}>
              {t("intelligence.clear")}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={t("externalProvider.apiKeyLabel")} htmlFor="anthropic-api-key">
                <Input
                  type="password"
                  mono
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && keyInput) handleSave(); }}
                  placeholder="sk-ant-api03-..."
                />
              </Field>
            </div>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !keyInput} loading={saving}>
              {t("intelligence.save")}
            </Button>
          </div>
        )}

        {!isConfigured && (
          <Button variant="ghost" size="sm" onClick={() => shellOpen("https://console.anthropic.com/settings/keys")} className="self-start">
            {t("externalProvider.getKeyLink")}
          </Button>
        )}

        {error && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-status-danger-text)" }}>
            {error}
          </p>
        )}

        {!isConfigured && showNoKeyGuidance && (
          <div
            className="rounded-lg"
            style={{
              padding: "10px 14px",
              backgroundColor: "var(--mem-hover)",
              fontSize: "12px",
              color: "var(--mem-text-secondary)",
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 500, color: "var(--mem-text)", marginBottom: 2, fontSize: "12px" }}>
              {t("intelligence.pageSynthesisRequiresCloud")}
            </div>
            <div>{t("intelligence.memorySafe")}</div>
            <div style={{ marginTop: 6 }}>{t("intelligence.addApiKey")}</div>
          </div>
        )}

        {isConfigured && showModelChoice && <ModelChoiceSection />}
      </div>
    </Card>
  );
}

export function ModelChoiceSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: modelChoice } = useQuery({
    queryKey: ["modelChoice"],
    queryFn: getModelChoice,
  });
  const [routineModel, synthesisModel] = modelChoice ?? [null, null];

  return (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--mem-border)" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style={{ fontSize: "var(--mem-text-base)", fontWeight: 500, color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}>{t("intelligence.routineModel")}</div>
          <div style={{ fontSize: "11px", color: "var(--mem-text-tertiary)", fontFamily: "var(--mem-font-body)" }}>{t("intelligence.routineModelDescription")}</div>
        </div>
        <div className="shrink-0 w-fit">
          <Select
            size="sm"
            mono
            aria-label={t("intelligence.chooseRoutineModel")}
            value={routineModel ?? "claude-haiku-4-5-20251001"}
            onChange={async (e) => {
              await setModelChoice(e.target.value, synthesisModel);
              queryClient.invalidateQueries({ queryKey: ["modelChoice"] });
            }}
          >
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label} - {t(m.descKey)}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div style={{ fontSize: "var(--mem-text-base)", fontWeight: 500, color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}>{t("intelligence.synthesisModel")}</div>
          <div style={{ fontSize: "11px", color: "var(--mem-text-tertiary)", fontFamily: "var(--mem-font-body)" }}>{t("intelligence.synthesisModelDescription")}</div>
        </div>
        <div className="shrink-0 w-fit">
          <Select
            size="sm"
            mono
            aria-label={t("intelligence.chooseSynthesisModel")}
            value={synthesisModel ?? "claude-sonnet-4-6"}
            onChange={async (e) => {
              await setModelChoice(routineModel, e.target.value);
              queryClient.invalidateQueries({ queryKey: ["modelChoice"] });
            }}
          >
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label} - {t(m.descKey)}</option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

export function OnDeviceModelCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: modelData } = useQuery({
    queryKey: ["onDeviceModel"],
    queryFn: getOnDeviceModel,
  });
  const { data: systemInfo } = useQuery({
    queryKey: ["systemInfo"],
    queryFn: getSystemInfo,
  });

  const models = modelData?.models ?? [];
  const loadedId = modelData?.loaded ?? null;
  const selectedId = modelData?.selected ?? null;
  const currentId = pickedId ?? loadedId ?? selectedId ?? models[0]?.id ?? null;
  const current = currentId ? models.find((m) => m.id === currentId) : null;

  const isLoaded = !!current && loadedId === current.id;
  const needsDownload = !!current && !current.cached;
  const canLoad = !!current && current.cached && !isLoaded;
  const ramOk = systemInfo ? systemInfo.total_ram_gb + 0.5 >= (current?.ram_required_gb ?? 0) : true;

  const handleDownload = async () => {
    if (!current) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadOnDeviceModel(current.id);
      queryClient.invalidateQueries({ queryKey: ["onDeviceModel"] });
      setPickedId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const statusBadge = isLoaded ? t("intelligence.running") : t("intelligence.notLoaded");

  return (
    <Card padding="card">
      <div className="flex flex-col" style={{ gap: "10px" }}>
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-lg)", fontWeight: 600, color: "var(--mem-text)" }}>
            {t("intelligence.onDeviceModel")}
          </h3>
          <StatusChip state={isLoaded ? { kind: "up" } : { kind: "idle" }} label={statusBadge} />
        </div>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "11px",
            color: "var(--mem-text-tertiary)",
          }}
        >
          {t("intelligence.localModelDescription")}
          {systemInfo && (
            <>
              {" "}
              {t("intelligence.systemInfo", {
                ram: systemInfo.total_ram_gb.toFixed(0),
                accelerators: [
                  systemInfo.has_metal ? " · Metal GPU" : "",
                  systemInfo.has_cuda ? " · CUDA GPU" : "",
                ].join(""),
              })}
            </>
          )}
        </p>

        <div className="flex items-start gap-2">
          {current && (
            <span
              data-testid="on-device-model-spec"
              className="flex-1 min-w-0"
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: "11px",
                color: "var(--mem-text-secondary)",
              }}
            >
              {t("intelligence.modelDetails", {
                params: current.param_count,
                downloadSize: current.file_size_gb.toFixed(1),
                ram: current.ram_required_gb.toFixed(0),
              })}
              {current.cached && !isLoaded && t("intelligence.downloadedNotLoaded")}
              {!current.cached && t("intelligence.notDownloaded")}
            </span>
          )}

          {models.length > 0 ? (
            <div className="shrink-0 w-fit">
              <Select
                size="sm"
                mono
                aria-label={t("intelligence.chooseOnDeviceModel")}
                value={currentId ?? ""}
                onChange={(e) => setPickedId(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <span
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "11px",
                color: "var(--mem-text-tertiary)",
              }}
            >
              {t("intelligence.modelCatalogUnavailable")}
            </span>
          )}

          {needsDownload && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownload}
              disabled={downloading || !ramOk}
              loading={downloading}
              className="whitespace-nowrap shrink-0"
              title={!ramOk ? t("intelligence.notEnoughRamTitle") : undefined}
            >
              {t("intelligence.downloadSize", { size: current?.file_size_gb.toFixed(1) })}
            </Button>
          )}
          {canLoad && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              loading={downloading}
              className="whitespace-nowrap shrink-0"
            >
              {t("intelligence.load")}
            </Button>
          )}
        </div>

        {downloading && (
          <p
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "11px",
              color: "var(--mem-text-tertiary)",
            }}
          >
            {t("intelligence.downloadMayTake", { size: current?.file_size_gb.toFixed(1) })}
          </p>
        )}
        {error && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-status-danger-text)" }}>
            {error}
          </p>
        )}
        {!ramOk && current && !downloading && (
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-status-warning-text)" }}>
            {t("intelligence.ramWarning", {
              model: current.display_name,
              required: current.ram_required_gb.toFixed(0),
              available: systemInfo?.total_ram_gb.toFixed(0),
            })}
          </p>
        )}
      </div>
    </Card>
  );
}
