// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getSetupStatus, getExternalLlm, getResolvedRouting, type ResolvedRouting } from "../../lib/tauri";
import { useDaemonVersion } from "../../hooks/useDaemonVersion";
import { Card, StatusChip, type ProbeState } from "../memory/settings/primitives";

/** Honest one-line status of what's serving intelligence.
 *
 *  Feature detection: a daemon with the routing endpoint (≥ PR #357) reports
 *  per-job resolved routing, so we REFLECT it — the strip must not re-derive a
 *  vendor-priority chain, which lies once jobs pin independent sources (e.g.
 *  everyday pinned on-device while an Anthropic key is configured would read
 *  "Serving: Anthropic"). Legacy daemons (null routing) keep the old derived
 *  chain, where the priority caption is still the honest description. */
export default function ActiveIntelligenceStrip() {
  const { data: routing } = useQuery({ queryKey: ["resolvedRouting"], queryFn: getResolvedRouting });
  return routing != null ? <PinnedStrip routing={routing} /> : <LegacyStrip />;
}

/** Pinned daemon: reflect the daemon's own per-job resolution. No priority
 *  caption — pins are independent, there is no chain to describe. */
function PinnedStrip({ routing }: { routing: ResolvedRouting }) {
  const { t } = useTranslation();

  const label = (source: string): string => {
    switch (source) {
      case "anthropic":
        return t("intelligence.sourceAnthropic");
      case "external":
        return t("intelligence.sourceConnectedProvider");
      case "on_device":
        return t("intelligence.sourceOnDevice");
      case "basic":
        return t("intelligenceStrip.sourceBasic");
      case "none":
        return t("intelligenceStrip.sourceOff");
      default:
        return t("intelligence.sourceConnectedProvider");
    }
  };

  // A degraded pin (the pinned source is unavailable, so the daemon fell back)
  // is not "serving as asked" — the chip goes amber (chip-never-lies). The
  // label still shows the RESOLVED source, i.e. what is actually serving now.
  const degraded =
    routing.everyday.mode === "pinned_degraded" || routing.synthesis.mode === "pinned_degraded";
  const chipKind: ProbeState["kind"] = degraded ? "stale" : "up";
  const topLine = t("intelligenceStrip.pinnedSummary", {
    everyday: label(routing.everyday.source),
    synthesis: label(routing.synthesis.source),
  });

  return (
    <Card>
      <div className="flex flex-col" style={{ gap: "8px" }}>
        <StatusChip state={{ kind: chipKind }} label={topLine} />
      </div>
    </Card>
  );
}

/** Legacy daemon (no routing endpoint): derive from config in priority order,
 *  Anthropic → external → on-device → basic. The chip's "up"/"stale"/"idle"
 *  kind is derived from the same buckets as topLine — serving,
 *  configured-unverified, restart-pending — so the two can never drift apart
 *  (chip-never-lies). The priority caption is honest here: this daemon really
 *  does resolve one chain, not independent per-job pins. */
function LegacyStrip() {
  const { t } = useTranslation();
  const { supportsHotSwap } = useDaemonVersion(); // ≥0.13 ⇔ setup status carries external_llm
  const { data: status } = useQuery({ queryKey: ["setup-status"], queryFn: getSetupStatus });
  const { data: external } = useQuery({ queryKey: ["external-llm"], queryFn: getExternalLlm });

  const externalConfigured = Boolean(external?.[0]);

  // Top of the chain first: Anthropic → external → on-device → basic.
  let topLine: string;
  let chipKind: ProbeState["kind"];
  if (status?.anthropic_key_configured) {
    topLine = t("intelligenceStrip.servingAnthropic");
    chipKind = "up";
  } else if (supportsHotSwap && status?.external_llm) {
    // Daemon ≥0.13 reports runtime state (spec §7.6).
    if (status.external_llm.loaded) {
      topLine = t("intelligenceStrip.servingExternal");
      chipKind = "up";
    } else if (status.external_llm.configured) {
      // Saved but not yet loaded by the daemon. Nothing has failed — the config
      // simply post-dates the running process. "stale", not "down".
      topLine = t("intelligenceStrip.externalRestartPending");
      chipKind = "stale";
    } else if (status?.local_model_loaded) {
      topLine = t("intelligenceStrip.servingOnDevice");
      chipKind = "up";
    } else {
      topLine = t("intelligenceStrip.servingBasic");
      chipKind = "up";
    }
  } else if (externalConfigured) {
    // 0.12: config is all we can see — never claim serving. But an unobservable
    // runtime is not a failed one: "idle" (not checked), never "down" (probed and
    // dead). Chip-never-lies runs both ways -- a red chip is a claim too.
    topLine = t("intelligenceStrip.externalUnverified");
    chipKind = "idle";
  } else if (status?.local_model_loaded) {
    topLine = t("intelligenceStrip.servingOnDevice");
    chipKind = "up";
  } else {
    topLine = t("intelligenceStrip.servingBasic");
    chipKind = "up";
  }

  return (
    <Card>
      <div className="flex flex-col" style={{ gap: "8px" }}>
        <StatusChip state={{ kind: chipKind }} label={topLine} />
        <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)" }}>
          {t("intelligenceStrip.chain")}
        </span>
      </div>
    </Card>
  );
}
