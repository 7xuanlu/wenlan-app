// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { clipboardWrite, getWenlanMcpEntry } from "../../lib/tauri";

export type CliClientType = "claude_code" | "codex_cli";

/** Clients whose §9.3 primary path is terminal commands, not one-click. */
export const CLI_PRIMARY_CLIENTS: Set<string> = new Set(["claude_code", "codex_cli"]);

/** §9.3 primary path for CLI clients, shared by ClientSetupList (settings)
 *  and the wizard ConnectStep rows: lead line, terminal command(s), reload
 *  note, and a "Copy setup prompt" button. */
export default function CliPrimaryPath({ clientType }: { clientType: CliClientType }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { data: mcpEntry } = useQuery({
    queryKey: ["wenlan-mcp-entry"],
    queryFn: getWenlanMcpEntry,
    staleTime: Infinity,
  });
  const cmd = mcpEntry ? `${mcpEntry.command} ${mcpEntry.args.join(" ")}` : "";

  const isClaudeCode = clientType === "claude_code";
  const lead = isClaudeCode
    ? t("connectMatrix.claudeCodePrimary")
    : t("connectMatrix.codexPrimary");
  const commands = isClaudeCode
    ? [t("connectMatrix.claudeCodeCommand1"), t("connectMatrix.claudeCodeCommand2")]
    : [t("connectMatrix.codexCommand", { cmd })];
  const reload = isClaudeCode
    ? t("connectMatrix.claudeCodeReload")
    : t("connectMatrix.codexReload");
  const prompt = isClaudeCode
    ? t("connectMatrix.claudeCodePrompt")
    : t("connectMatrix.codexPrompt", { cmd });

  const copyPrompt = async () => {
    try {
      await clipboardWrite(prompt);
      setCopied(true);
    } catch {
      /* clipboard denial is non-fatal */
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", margin: 0 }}>
        {lead}
      </p>
      {commands.map((c) => (
        <code
          key={c}
          className="block truncate rounded-md px-2 py-1.5"
          style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", backgroundColor: "var(--mem-bg)", border: "1px solid var(--mem-border)", color: "var(--mem-text)" }}
        >
          {c}
        </code>
      ))}
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)", margin: 0 }}>
        {reload}
      </p>
      <button
        type="button"
        onClick={copyPrompt}
        className="self-start rounded-md px-3 py-1.5 text-xs"
        style={{ border: "1px solid var(--mem-border)", color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}
      >
        {copied ? t("connectMatrix.promptCopied") : t("connectMatrix.copySetupPrompt")}
      </button>
    </div>
  );
}
