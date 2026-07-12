// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { detectMcpClients, writeMcpConfig, type McpClient } from "../../lib/tauri";
import CliPrimaryPath, { isCliPrimaryClient } from "./CliPrimaryPath";
import ClientRow from "./ClientRow";
import { Button } from "../memory/settings/primitives";

/** Apps & CLIs group (spec §2a / §9.3), thinned per the redesign spec (§4)
 *  to compose over the shared `ClientRow`. Claude Code leads with its
 *  plugin-install path (`CliPrimaryPath`); its one-click config write stays
 *  under Advanced here — unlike the wizard, which never writes Claude
 *  Code's config at all (spec §12.2), Settings is a deliberate,
 *  one-at-a-time destination the user chose to visit, and the Advanced
 *  disclosure is itself the extra deliberate step. Every other client keeps
 *  the one-click "Set up". */
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

  const advancedSetUp = (client: McpClient) => (
    <details>
      <summary style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)", cursor: "pointer" }}>
        {t("connectMatrix.advanced")}
      </summary>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setUp(client.client_type)}
        disabled={busy === client.client_type}
        className="mt-2"
      >
        {busy === client.client_type ? t("connectMatrix.settingUp") : t("connectMatrix.oneClickAdvanced")}
      </Button>
    </details>
  );

  const notInstalled = (
    <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
      {t("connectMatrix.notDetected")}
    </span>
  );

  const guiTrailing = (client: McpClient) =>
    client.already_configured
      ? null
      : client.detected
        ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setUp(client.client_type)}
              disabled={busy === client.client_type}
            >
              {busy === client.client_type ? t("connectMatrix.settingUp") : t("connectMatrix.setUp")}
            </Button>
          )
        : notInstalled;

  // A plugin-install command for a client that isn't on the machine can't
  // succeed anyway — gate the CLI body on detection too, same as the GUI
  // trailing action, so an undetected client always shows "Not installed".
  const cliBody = (client: McpClient) =>
    client.detected ? (
      <>
        <CliPrimaryPath />
        {advancedSetUp(client)}
      </>
    ) : null;

  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      {(clients ?? []).map((client) =>
        isCliPrimaryClient(client.client_type) ? (
          <ClientRow
            key={client.client_type}
            client={client}
            showConfigPath
            configured={client.already_configured}
            error={errors[client.client_type]}
            trailing={client.detected ? null : notInstalled}
          >
            {cliBody(client)}
          </ClientRow>
        ) : (
          <ClientRow
            key={client.client_type}
            client={client}
            showConfigPath
            configured={client.already_configured}
            error={errors[client.client_type]}
            trailing={guiTrailing(client)}
          />
        ),
      )}
    </div>
  );
}
