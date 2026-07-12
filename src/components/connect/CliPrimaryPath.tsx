// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { clipboardWrite } from "../../lib/tauri";
import { useTranslation } from "react-i18next";

/** Claude Code is the only client left on this path (redesign spec §12.2):
 *  writing its config programmatically would duplicate the MCP server the
 *  Wenlan Claude Code plugin already registers, so it never gets a
 *  one-click write — only this plugin-install path. Codex CLI moved to the
 *  ordinary checkbox/batch-write path, since its config is safe to write. */
export type CliClientType = "claude_code";

/** Type guard for `McpClient.client_type` (a plain `string`). */
export function isCliPrimaryClient(clientType: string): clientType is CliClientType {
  return clientType === "claude_code";
}

/** Claude Code's plugin-install path, shared by ClientSetupList (settings)
 *  and the wizard's ConnectStep: lead line, a primary "Copy setup prompt"
 *  button, then the terminal commands + reload note behind a disclosure.
 *  Takes no props — `CliClientType` has exactly one member. */
export default function CliPrimaryPath() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copiedCommandIndex, setCopiedCommandIndex] = useState<number | null>(null);

  const lead = t("connectMatrix.claudeCodePrimary");
  const commands = [
    t("connectMatrix.claudeCodeCommand1"),
    t("connectMatrix.claudeCodeCommand2"),
    t("connectMatrix.claudeCodeCommand3"),
  ];
  const reload = t("connectMatrix.claudeCodeReload");
  const prompt = t("connectMatrix.claudeCodePrompt");

  const copyPrompt = async () => {
    try {
      await clipboardWrite(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denial is non-fatal */
    }
  };

  const copyCommand = async (index: number, text: string) => {
    try {
      await clipboardWrite(text);
      setCopiedCommandIndex(index);
      setTimeout(() => setCopiedCommandIndex((cur) => (cur === index ? null : cur)), 2000);
    } catch {
      /* clipboard denial is non-fatal */
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", margin: 0 }}>
        {lead}
      </p>
      <button
        type="button"
        onClick={copyPrompt}
        className="self-start rounded-md px-3 py-1.5 text-xs"
        style={{ border: "1px solid var(--mem-border)", color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}
      >
        {copied ? t("connectMatrix.promptCopied") : t("connectMatrix.copySetupPrompt")}
      </button>

      <details>
        <summary style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)", cursor: "pointer" }}>
          {t("connectMatrix.showCommands")}
        </summary>
        <div className="flex flex-col gap-2 mt-2">
          {commands.map((c, i) => (
            <div key={c} className="flex items-center gap-2">
              <code
                className="flex-1 whitespace-pre-wrap break-all rounded-md px-2 py-1.5"
                style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", backgroundColor: "var(--mem-bg)", border: "1px solid var(--mem-border)", color: "var(--mem-text)" }}
              >
                {c}
              </code>
              <button
                type="button"
                onClick={() => copyCommand(i, c)}
                aria-label={t("connectMatrix.copyCommandAria", { cmd: c })}
                className="shrink-0 rounded-md px-2 py-1 text-xs"
                style={{ border: "1px solid var(--mem-border)", color: "var(--mem-text)", fontFamily: "var(--mem-font-body)" }}
              >
                {copiedCommandIndex === i
                  ? t("connectMatrix.commandCopied")
                  : t("connectMatrix.copyCommand")}
              </button>
            </div>
          ))}
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)", margin: 0 }}>
            {reload}
          </p>
        </div>
      </details>
    </div>
  );
}
