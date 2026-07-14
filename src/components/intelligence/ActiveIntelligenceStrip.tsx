// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getSetupStatus, getExternalLlm } from "../../lib/tauri";
import { useDaemonVersion } from "../../hooks/useDaemonVersion";
import { Card, StatusChip, type ProbeState } from "../memory/settings/primitives";

/** One-line honest status of the daemon priority chain (spec §1, council
 *  change c): "serving" only from daemon runtime state, never from config.
 *  The chip's "up"/"down" kind is derived from the same three buckets as
 *  topLine — serving, configured-unverified, restart-pending — so the two
 *  can never drift apart (chip-never-lies). */
export default function ActiveIntelligenceStrip() {
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
