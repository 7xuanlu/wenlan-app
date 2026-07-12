// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getPipelineStatus, type PipelineStatusResponse } from "../../../../lib/tauri";
import { Button, Card } from "../primitives";

function sortedEntries(values: Record<string, number>): [string, number][] {
  return Object.entries(values).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (rightValue !== leftValue) return rightValue - leftValue;
    return leftKey.localeCompare(rightKey);
  });
}

function isOldDaemonError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("/api/debug/pipeline") &&
    (lowerMessage.includes("404") || lowerMessage.includes("not found"))
  );
}

function StatList({
  title,
  values,
  empty,
}: {
  title: string;
  values: Record<string, number>;
  empty: string;
}) {
  const entries = sortedEntries(values);
  return (
    <div className="px-5 py-4">
      <div className="mb-2" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-base)", fontWeight: 600, color: "var(--mem-text)" }}>
        {title}
      </div>
      {entries.length === 0 ? (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)" }}>{empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(([key, count]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)" }}>{key}</span>
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text)" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityLinking({ data }: { data: PipelineStatusResponse }) {
  const { t } = useTranslation();
  const total = data.entity_linking.linked + data.entity_linking.unlinked;
  const percent = total === 0 ? null : Math.round((data.entity_linking.linked / total) * 100);
  return (
    <div className="px-5 py-4">
      <div className="mb-2" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-base)", fontWeight: 600, color: "var(--mem-text)" }}>
        {t("settings.diagnostics.entityLinking")}
      </div>
      <div className="flex items-baseline gap-3">
        <span style={{ fontFamily: "var(--mem-font-heading)", fontSize: "var(--mem-text-xl)", color: "var(--mem-text)" }}>{data.entity_linking.linked}</span>
        <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)" }}>
          {t("settings.diagnostics.linkedUnlinked", { unlinked: data.entity_linking.unlinked })}
        </span>
      </div>
      {percent !== null && (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)", marginTop: 4 }}>
          {t("settings.diagnostics.percentLinked", { percent })}
        </p>
      )}
    </div>
  );
}

function RefineryQueue({ data }: { data: PipelineStatusResponse }) {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-4">
      <div className="mb-2" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-base)", fontWeight: 600, color: "var(--mem-text)" }}>
        {t("settings.diagnostics.refineryQueue")}
      </div>
      {data.refinement_queue.length === 0 ? (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)" }}>{t("settings.diagnostics.refineryEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.refinement_queue.map((entry) => (
            <div key={`${entry.action}:${entry.status}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)" }}>{entry.action}</span>
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)" }}>{entry.status}</span>
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text)" }}>{entry.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <p className="px-5 py-4" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-status-danger-text)", lineHeight: "1.5" }}>
      {isOldDaemonError(error) ? t("settings.diagnostics.needsNewerDaemon") : t("settings.diagnostics.unavailable")}
    </p>
  );
}

export default function DiagnosticsSection() {
  const { t } = useTranslation();
  const pipelineQuery = useQuery({
    queryKey: ["pipelineStatus"],
    queryFn: getPipelineStatus,
    retry: false,
  });

  return (
    <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <h3 style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-2xs)", fontWeight: 500, letterSpacing: "0.14em", color: "var(--mem-text-tertiary)", textTransform: "uppercase" as const }}>
          {t("settings.diagnostics.pipelineTitle")}
        </h3>
        <Button variant="secondary" size="sm" onClick={() => pipelineQuery.refetch()}>
          {t("settings.diagnostics.refresh")}
        </Button>
      </div>
      <Card padding="rows">
        {pipelineQuery.isLoading && (
          <p className="px-5 py-4" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)" }}>
            {t("settings.diagnostics.loading")}
          </p>
        )}
        {pipelineQuery.isError && <DiagnosticsError error={pipelineQuery.error} />}
        {pipelineQuery.data && (
          <>
            <StatList title={t("settings.diagnostics.enrichment")} values={pipelineQuery.data.enrichment} empty={t("settings.diagnostics.enrichmentEmpty")} />
            <EntityLinking data={pipelineQuery.data} />
            <RefineryQueue data={pipelineQuery.data} />
            <div className="px-5 py-4">
              <div className="mb-1" style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-base)", fontWeight: 600, color: "var(--mem-text)" }}>{t("settings.diagnostics.recaps")}</div>
              <span style={{ fontFamily: "var(--mem-font-heading)", fontSize: "var(--mem-text-xl)", color: "var(--mem-text)" }}>{pipelineQuery.data.recaps}</span>
            </div>
            <StatList title={t("settings.diagnostics.memoryTypes")} values={pipelineQuery.data.types} empty={t("settings.diagnostics.memoryTypesEmpty")} />
            <StatList title={t("settings.diagnostics.quality")} values={pipelineQuery.data.quality} empty={t("settings.diagnostics.qualityEmpty")} />
          </>
        )}
      </Card>
    </section>
  );
}
