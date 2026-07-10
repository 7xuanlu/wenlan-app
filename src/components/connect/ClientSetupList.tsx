// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { detectMcpClients, writeMcpConfig } from "../../lib/tauri";

/** Apps & CLIs group (spec §2a group 2): one row per registry client,
 *  "Set up" writes the MCP config, path in mono, errors verbatim. */
export default function ClientSetupList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: clients } = useQuery({ queryKey: ["mcp-clients"], queryFn: detectMcpClients });

  const setUp = async (clientType: string) => {
    setBusy(clientType);
    setErrors((prev) => ({ ...prev, [clientType]: "" }));
    try {
      await writeMcpConfig(clientType);
      queryClient.invalidateQueries({ queryKey: ["mcp-clients"] });
    } catch (err) {
      setErrors((prev) => ({ ...prev, [clientType]: String(err) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      {(clients ?? []).map((client) => (
        <div
          key={client.client_type}
          className="rounded-lg px-3 py-2.5 flex items-center gap-3"
          style={{ border: "1px solid var(--mem-border)", backgroundColor: "var(--mem-surface)" }}
        >
          <div className="flex-1 min-w-0">
            <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "13px", fontWeight: 500, color: "var(--mem-text)", margin: 0 }}>
              {client.name}
            </p>
            <p className="truncate" style={{ fontFamily: "var(--mem-font-mono)", fontSize: "10px", color: "var(--mem-text-tertiary)", margin: 0 }}>
              {client.config_path}
            </p>
            {errors[client.client_type] && (
              <p className="text-red-500" style={{ fontFamily: "var(--mem-font-mono)", fontSize: "10px", margin: 0 }}>
                {errors[client.client_type]}
              </p>
            )}
          </div>
          {client.already_configured ? (
            <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-accent-sage)" }}>
              {t("connectMatrix.configured")}
            </span>
          ) : client.detected ? (
            <button
              onClick={() => setUp(client.client_type)}
              disabled={busy === client.client_type}
              className="rounded-md px-3 py-1.5 text-xs disabled:opacity-50 shrink-0"
              style={{ backgroundColor: "var(--mem-accent-indigo)", color: "white", fontFamily: "var(--mem-font-body)" }}
            >
              {busy === client.client_type ? t("connectMatrix.settingUp") : t("connectMatrix.setUp")}
            </button>
          ) : (
            <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
              {t("connectMatrix.notDetected")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
