// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getExternalLlm, getModelChoice, getOnDeviceModel } from "../../../../lib/tauri";
import ActiveIntelligenceStrip from "../../../intelligence/ActiveIntelligenceStrip";
import AnyProviderCard from "../../../intelligence/AnyProviderCard";
import {
  ANTHROPIC_MODELS,
  OnDeviceModelCard,
  RoutineModelSelect,
  SynthesisModelSelect,
  useApiKeyStatus,
} from "../../../intelligence/IntelligenceSetup";
import { presetForEndpoint, type PresetGroup } from "../../../intelligence/providerPresets";
import { Card, SectionHeader, StatusChip, type ProbeState } from "../primitives";

// Module-level so each is a stable reference across renders — AnyProviderCard
// memoizes its preset list on these (same convention as SetupWizard's
// identical CLOUD_GROUPS/LOCAL_GROUPS, whose steps these rows mirror).
const CLOUD_GROUPS: PresetGroup[] = ["cloud"];
const LOCAL_GROUPS: PresetGroup[] = ["local", "custom"];

// ModelChoiceSection's own <Select> defaults — mirrored here so the summary
// meta names a model even before the user has ever touched the picker.
const DEFAULT_ROUTINE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_SYNTHESIS_MODEL = "claude-sonnet-4-6";

function anthropicModelLabel(id: string): string {
  return ANTHROPIC_MODELS.find((m) => m.id === id)?.label ?? id;
}

type JobRowId = "everyday" | "synthesis";
type SourceRowId = "cloud" | "local" | "onDevice";

/** One disclosure row inside a Models/Providers card: header button (name /
 *  optional hint / meta / status chip / chevron) plus an expanded body slot.
 *  Mirrors the chevron affordance RemoteAccessPanel's URL disclosure used
 *  (aria-expanded + rotate-90 svg). */
function ProviderRow({
  name,
  hint,
  meta,
  chipState,
  chipLabel,
  expanded,
  onToggle,
  children,
}: {
  name: string;
  /** Static capability/recommendation caption shown above the state-derived
   *  meta line. Job rows always pass one ("what this job does"); among
   *  source rows only On-device does — Cloud/Local fold the same kind of
   *  copy into their meta's unconfigured fallback instead. */
  hint?: string;
  meta: string;
  chipState: ProbeState;
  chipLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-md)", fontWeight: 500, color: "var(--mem-text)" }}>
            {name}
          </div>
          {hint && (
            <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)", marginTop: "2px" }}>
              {hint}
            </p>
          )}
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: 1.5 }}>
            {meta}
          </p>
        </div>
        <StatusChip state={chipState} label={chipLabel} />
        <svg
          className="w-3 h-3 shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", color: "var(--mem-text-tertiary)" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

export default function IntelligenceSection({ delay }: { delay: number }) {
  const { t } = useTranslation();
  const anthropic = useApiKeyStatus();
  const { data: external } = useQuery({ queryKey: ["external-llm"], queryFn: getExternalLlm });
  const { data: modelChoice } = useQuery({
    queryKey: ["modelChoice"],
    queryFn: getModelChoice,
    enabled: anthropic.isConfigured,
  });
  const { data: onDevice } = useQuery({ queryKey: ["onDeviceModel"], queryFn: getOnDeviceModel });

  const [expandedJob, setExpandedJob] = useState<JobRowId | null>(null);
  const toggleJob = (row: JobRowId) => setExpandedJob((cur) => (cur === row ? null : row));
  const [expandedSource, setExpandedSource] = useState<SourceRowId | null>(null);
  const toggleSource = (row: SourceRowId) => setExpandedSource((cur) => (cur === row ? null : row));

  // The daemon holds exactly one external-llm slot — a saved local server and
  // a saved cloud vendor overwrite each other — so the saved slot is
  // attributed to exactly one row, via its own preset's group.
  const [externalEndpoint, externalModel] = external ?? [null, null];
  const externalPreset = externalEndpoint ? presetForEndpoint(externalEndpoint) : null;
  const externalConfigured = externalPreset !== null;
  const cloudConnected = anthropic.isConfigured || externalPreset?.group === "cloud";
  const localConnected = externalPreset?.group === "local" || externalPreset?.group === "custom";

  const [routineId, synthesisId] = modelChoice ?? [null, null];
  const cloudMeta = anthropic.isConfigured
    ? `Anthropic · ${t("intelligence.routineModel")}: ${anthropicModelLabel(routineId ?? DEFAULT_ROUTINE_MODEL)} · ${t("intelligence.synthesisModel")}: ${anthropicModelLabel(synthesisId ?? DEFAULT_SYNTHESIS_MODEL)}`
    : externalPreset?.group === "cloud"
      ? `${externalPreset.name} · ${externalModel}`
      : t("intelligence.cloudRowHint");

  const localMeta = localConnected && externalPreset
    ? `${externalPreset.name} · ${externalModel}`
    : t("intelligence.localRowHint");

  const models = onDevice?.models ?? [];
  const loadedId = onDevice?.loaded ?? null;
  const selectedId = onDevice?.selected ?? null;
  const currentId = loadedId ?? selectedId ?? models[0]?.id ?? null;
  const current = currentId ? models.find((m) => m.id === currentId) : null;
  const onDeviceLoaded = !!current && loadedId === current.id;

  const onDeviceMeta = !current
    ? t("intelligence.modelCatalogUnavailable")
    : onDeviceLoaded
      ? `${current.display_name} · ${t("intelligence.running")}`
      : current.cached
        ? `${current.display_name}${t("intelligence.downloadedNotLoaded")}`
        : `${current.display_name}${t("intelligence.notDownloaded")}`;

  // The two jobs walk the same source-priority chain the strip uses
  // (Anthropic → external → on-device → basic) — but independently, since
  // mix-and-match is real: everyday tasks can run on-device while synthesis
  // still needs a cloud key. Synthesis skips the on-device tier entirely —
  // the small on-device model never runs synthesis (pageSynthesisRequiresCloud).
  const everydayConnected = anthropic.isConfigured || externalConfigured || onDeviceLoaded;
  const everydayMeta = anthropic.isConfigured
    ? `Anthropic · ${anthropicModelLabel(routineId ?? DEFAULT_ROUTINE_MODEL)}`
    : externalConfigured && externalPreset
      ? `${externalPreset.name} · ${externalModel}`
      : onDeviceLoaded && current
        ? current.display_name
        : t("intelligenceStrip.servingBasic");
  const everydaySourceLine = externalConfigured && externalPreset
    ? t("intelligenceStrip.servingExternal")
    : onDeviceLoaded
      ? t("intelligenceStrip.servingOnDevice")
      : t("intelligenceStrip.servingBasic");

  const synthesisConnected = anthropic.isConfigured || externalConfigured;
  const synthesisMeta = anthropic.isConfigured
    ? `Anthropic · ${anthropicModelLabel(synthesisId ?? DEFAULT_SYNTHESIS_MODEL)}`
    : externalConfigured && externalPreset
      ? `${externalPreset.name} · ${externalModel}`
      : t("intelligence.pageSynthesisRequiresCloud");
  const synthesisSourceLine = externalConfigured && externalPreset
    ? t("intelligenceStrip.servingExternal")
    : t("intelligence.pageSynthesisRequiresCloud");

  const sourceLineStyle = { fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)", lineHeight: 1.5 } as const;

  return (
    <section className="mem-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-col gap-3">
        <ActiveIntelligenceStrip />

        <div className="mem-fade-up" style={{ animationDelay: `${delay + 30}ms` }}>
          <SectionHeader label={t("intelligence.modelsTitle")} />
          <Card padding="rows">
            <ProviderRow
              name={t("intelligence.routineModel")}
              hint={t("intelligence.routineModelDescription")}
              meta={everydayMeta}
              chipState={everydayConnected ? { kind: "up" } : { kind: "idle" }}
              chipLabel={everydayConnected ? t("intelligence.connected") : t("intelligence.notConfigured")}
              expanded={expandedJob === "everyday"}
              onToggle={() => toggleJob("everyday")}
            >
              {anthropic.isConfigured ? <RoutineModelSelect /> : <p style={sourceLineStyle}>{everydaySourceLine}</p>}
            </ProviderRow>
            <ProviderRow
              name={t("intelligence.synthesisModel")}
              hint={t("intelligence.synthesisModelDescription")}
              meta={synthesisMeta}
              chipState={synthesisConnected ? { kind: "up" } : { kind: "idle" }}
              chipLabel={synthesisConnected ? t("intelligence.connected") : t("intelligence.notConfigured")}
              expanded={expandedJob === "synthesis"}
              onToggle={() => toggleJob("synthesis")}
            >
              {anthropic.isConfigured ? <SynthesisModelSelect /> : <p style={sourceLineStyle}>{synthesisSourceLine}</p>}
            </ProviderRow>
          </Card>
        </div>

        <div className="mem-fade-up" style={{ animationDelay: `${delay + 60}ms` }}>
          <SectionHeader label={t("intelligence.providersTitle")} />
          <Card padding="rows">
            <ProviderRow
              name={t("intelligence.cloudRow")}
              meta={cloudMeta}
              chipState={cloudConnected ? { kind: "up" } : { kind: "idle" }}
              chipLabel={cloudConnected ? t("intelligence.connected") : t("intelligence.notConfigured")}
              expanded={expandedSource === "cloud"}
              onToggle={() => toggleSource("cloud")}
            >
              <AnyProviderCard bare groups={CLOUD_GROUPS} />
            </ProviderRow>
            <ProviderRow
              name={t("intelligence.localRow")}
              meta={localMeta}
              chipState={localConnected ? { kind: "up" } : { kind: "idle" }}
              chipLabel={localConnected ? t("intelligence.connected") : t("intelligence.notConfigured")}
              expanded={expandedSource === "local"}
              onToggle={() => toggleSource("local")}
            >
              <AnyProviderCard bare groups={LOCAL_GROUPS} />
            </ProviderRow>
            <ProviderRow
              name={t("intelligence.onDeviceModel")}
              hint={t("intelligence.onDeviceRowHint")}
              meta={onDeviceMeta}
              chipState={onDeviceLoaded ? { kind: "up" } : { kind: "idle" }}
              chipLabel={onDeviceLoaded ? t("intelligence.running") : t("intelligence.notLoaded")}
              expanded={expandedSource === "onDevice"}
              onToggle={() => toggleSource("onDevice")}
            >
              <OnDeviceModelCard bare />
            </ProviderRow>
          </Card>
        </div>
      </div>
    </section>
  );
}
