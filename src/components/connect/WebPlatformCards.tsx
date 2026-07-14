// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { clipboardWrite, getRemoteAccessStatus, listAgents } from "../../lib/tauri";
import { Button, Card } from "../memory/settings/primitives";

/** Per-platform web connect cards (spec §2a group 1; §9.3 round 2: the
 *  Claude card is install-only — step 1 installs Wenlan via the Directory's
 *  Add-marketplace dialog, and once Remote access is on the connector reaches
 *  memory through the relay automatically, so there is no URL to paste. Only
 *  ChatGPT still pastes a Server URL). Verification is the existing listAgents
 *  delta poll — best-effort attribution: a new agent in the poll window flips
 *  the last-copied card (hint, not proof). */
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
    remote?.status === "connected" ? (remote.relay_url ?? `${remote.tunnel_url}/mcp`) : null;

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
    try {
      await clipboardWrite(url);
    } catch {
      return;
    }
    baselineCount.current = agents?.length ?? baselineCount.current;
    setCopiedPlatform(platform);
  };

  const stepHeading = (text: string) => (
    <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", fontWeight: 600, color: "var(--mem-text)", margin: 0 }}>
      {text}
    </p>
  );

  const stepList = (steps: string[]) => (
    <ol style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)", lineHeight: 1.7, paddingLeft: "18px", listStyle: "decimal", margin: 0 }}>
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );

  const urlRow = (platform: string) =>
    url ? (
      <div className="flex items-center gap-2">
        <code
          className="flex-1 truncate rounded-md px-2 py-1.5"
          style={{ fontFamily: "var(--mem-font-mono)", fontSize: "var(--mem-text-xs)", backgroundColor: "var(--mem-bg)", border: "1px solid var(--mem-border)", color: "var(--mem-text)" }}
        >
          {url}
        </code>
        <Button type="button" variant="ghost" size="sm" onClick={() => copy(platform)} className="shrink-0">
          {copiedPlatform === platform ? t("connectMatrix.copied") : t("connectMatrix.copyUrl")}
        </Button>
      </div>
    ) : (
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)" }}>
        {t("connectMatrix.tunnelOff")}
      </p>
    );

  const cardShell = (platform: "claude" | "chatgpt", title: string, children: ReactNode) => (
    <Card padding="none">
      <div className="p-4 flex flex-col" style={{ gap: "10px" }}>
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-lg)", fontWeight: 600, color: "var(--mem-text)" }}>
            {title}
          </h3>
          {connectedPlatform === platform && (
            <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-accent-sage)" }}>
              {t("connectMatrix.connectedHint")}
            </span>
          )}
        </div>
        {children}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      {cardShell(
        "claude",
        t("connectMatrix.claudeTitle"),
        <>
          {/* Install-only (§9.3: actionable today via Directory → Plugins →
              + Add marketplace, Personal tab). The connector step and its URL
              paste are gone — once Remote access is on, the relay carries memory
              to the installed Wenlan with nothing to configure. */}
          {stepHeading(t("connectMatrix.claudePluginStepTitle"))}
          {stepList([
            t("connectMatrix.claudePluginStep1"),
            t("connectMatrix.claudePluginStep2"),
            t("connectMatrix.claudePluginStep3"),
          ])}
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)", lineHeight: 1.5, margin: 0 }}>
            {t("connectMatrix.claudePluginNote")}
          </p>
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)", lineHeight: 1.5, margin: 0 }}>
            {t("connectMatrix.claudeRelayNote")}
          </p>
        </>,
      )}
      {cardShell(
        "chatgpt",
        t("connectMatrix.chatgptTitle"),
        <>
          {stepList([
            t("connectMatrix.chatgptStep1"),
            t("connectMatrix.chatgptStep2"),
            t("connectMatrix.chatgptStep3"),
          ])}
          {urlRow("chatgpt")}
        </>,
      )}
    </div>
  );
}
