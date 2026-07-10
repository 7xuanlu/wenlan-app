// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRemoteAccessStatus, listAgents } from "../../lib/tauri";

/** Per-platform web connect cards (spec §2a group 1). Verification is the
 *  existing listAgents delta poll — best-effort attribution: a new agent in
 *  the poll window flips the last-copied card (hint, not proof). */
export default function WebPlatformCards() {
  const { t } = useTranslation();
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);
  const [connectedPlatform, setConnectedPlatform] = useState<string | null>(null);
  const baselineCount = useRef<number | null>(null);

  const { data: remote } = useQuery({
    queryKey: ["remote-access-status"],
    queryFn: getRemoteAccessStatus,
    refetchInterval: 3000,
  });
  const url =
    remote?.status === "connected" ? (remote.relay_url ?? remote.tunnel_url) : null;

  const { data: agents } = useQuery({
    queryKey: ["web-connect-agents"],
    queryFn: listAgents,
    refetchInterval: copiedPlatform !== null && connectedPlatform === null ? 3000 : false,
  });
  useEffect(() => {
    if (!agents) return;
    if (baselineCount.current === null) {
      baselineCount.current = agents.length;
      return;
    }
    if (copiedPlatform !== null && agents.length > baselineCount.current) {
      setConnectedPlatform(copiedPlatform);
    }
  }, [agents, copiedPlatform]);

  const copy = async (platform: string) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    baselineCount.current = agents?.length ?? baselineCount.current;
    setCopiedPlatform(platform);
  };

  const card = (platform: "claude" | "chatgpt", title: string, steps: string[]) => (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ border: "1px solid var(--mem-border)", backgroundColor: "var(--mem-surface)", gap: "10px" }}
    >
      <div className="flex items-center justify-between">
        <h3 style={{ fontFamily: "var(--mem-font-heading)", fontSize: "15px", fontWeight: 500, color: "var(--mem-text)" }}>
          {title}
        </h3>
        {connectedPlatform === platform && (
          <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-accent-sage)" }}>
            {t("connectMatrix.connectedHint")}
          </span>
        )}
      </div>
      <ol style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", lineHeight: 1.7, paddingLeft: "18px", listStyle: "decimal", margin: 0 }}>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {url ? (
        <div className="flex items-center gap-2">
          <code
            className="flex-1 truncate rounded-md px-2 py-1.5"
            style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", backgroundColor: "var(--mem-bg)", border: "1px solid var(--mem-border)", color: "var(--mem-text)" }}
          >
            {url}
          </code>
          <button
            onClick={() => copy(platform)}
            className="rounded-md px-3 py-1.5 text-xs shrink-0"
            style={{ border: "1px solid var(--mem-border)", color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}
          >
            {copiedPlatform === platform ? t("connectMatrix.copied") : t("connectMatrix.copyUrl")}
          </button>
        </div>
      ) : (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-tertiary)" }}>
          {t("connectMatrix.tunnelOff")}
        </p>
      )}
      {/* No-auth boundary (council change f, commit 3a272d0): always visible. */}
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-accent-amber)", lineHeight: 1.5 }}>
        {t("connectMatrix.noAuthWarning")}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      {card("claude", t("connectMatrix.claudeTitle"), [
        t("connectMatrix.claudeStep1"),
        t("connectMatrix.claudeStep2"),
        t("connectMatrix.claudeStep3"),
      ])}
      {card("chatgpt", t("connectMatrix.chatgptTitle"), [
        t("connectMatrix.chatgptStep1"),
        t("connectMatrix.chatgptStep2"),
        t("connectMatrix.chatgptStep3"),
      ])}
    </div>
  );
}
