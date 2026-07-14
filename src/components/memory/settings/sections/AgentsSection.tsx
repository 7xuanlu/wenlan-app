// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  listAgents,
  updateAgent,
  deleteAgent,
  detectMcpClients,
} from "../../../../lib/tauri";
import { describeTrustLevel, resolveAgentDisplayName, TRUST_LEVELS } from "../../../../lib/agents";
import { RemoteAccessPanel } from "../../RemoteAccessPanel";
import { Button, Card, ConfirmActionButton, SectionHeader, Select, Tag, Toggle } from "../primitives";
import WebPlatformCards from "../../../connect/WebPlatformCards";
import ClientSetupList from "../../../connect/ClientSetupList";

export default function AgentsSection({ onSetupAgent }: { onSetupAgent?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // ── Connected Agents ───────────────────────────────────────────────
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
  });

  // Detect configured MCP clients to show pending connections
  const { data: mcpClients = [] } = useQuery({
    queryKey: ["mcp-clients"],
    queryFn: detectMcpClients,
  });

  // Show configured clients that have not written a first memory yet.
  const registeredClientTypes = new Set(agents.map((agent) => agent.agent_type));
  const pendingClients = mcpClients.filter(
    (client) => client.already_configured && !registeredClientTypes.has(client.client_type),
  );

  const updateAgentMut = useMutation({
    mutationFn: ({ name, updates }: { name: string; updates: { enabled?: boolean; trustLevel?: string } }) =>
      updateAgent(name, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const deleteAgentMut = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  return (
    <>
      {/* ── Connected Agents ─────────────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
        <SectionHeader label={t("settings.agents.connectedAgents")} />
        <Card padding={agents.length === 0 && pendingClients.length === 0 ? "none" : "rows"}>
          {agents.length === 0 && pendingClients.length === 0 ? (
            <div className="px-5 py-6 text-center space-y-3">
              <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-base)", color: "var(--mem-text-tertiary)" }}>
                {t("settings.agents.noAgents")}
              </p>
              <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-tertiary)", opacity: 0.7, lineHeight: "1.5" }}>
                {t("settings.agents.noAgentsDescription")}
              </p>
              {onSetupAgent && (
                <Button variant="primary" size="sm" onClick={onSetupAgent}>
                  {t("settings.agents.setupTool")}
                </Button>
              )}
            </div>
          ) : (
            <>
              {pendingClients.map((client) => (
                <div
                  key={client.client_type}
                  className="px-5 py-3"
                  style={{
                    opacity: 0.7,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-md)", fontWeight: 500, color: "var(--mem-text)" }}>
                          {client.name}
                        </span>
                        <Tag tone="neutral">{t("settings.agents.configured")}</Tag>
                      </div>
                      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)", marginTop: "2px" }}>
                        {t("settings.agents.restartToActivate", { name: client.name })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="px-5 py-3 transition-opacity"
                  style={{
                    /* no left border strip */
                    opacity: agent.enabled ? 1 : 0.5,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Display name (prominent, what the user cares about) */}
                        <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-md)", fontWeight: 500, color: "var(--mem-text)" }}>
                          {resolveAgentDisplayName(agent.name, agents)}
                        </span>
                        {/* Trust badge lives in the right-hand action cluster
                            below — it's a `Select` that doubles as both the
                            display and the editor. */}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {/* Canonical technical ID + machine type — always
                            shown as a mono subtitle, every row gets identical
                            anatomy. Machine identifiers are never chips. */}
                        <span
                          title={t("settings.agents.canonicalIdTitle")}
                          style={{
                            fontFamily: "var(--mem-font-mono)",
                            fontSize: "var(--mem-text-2xs)",
                            color: "var(--mem-text-tertiary)",
                            opacity: 0.75,
                          }}
                        >
                          {agent.name} · {agent.agent_type}
                        </span>
                        <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)" }}>
                          {t("settings.agents.memories", { count: agent.memory_count })}
                        </span>
                        {agent.last_seen_at && (
                          <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", color: "var(--mem-text-tertiary)" }}>
                            {t("settings.agents.lastSeen", {
                              date: new Date(agent.last_seen_at * 1000).toLocaleDateString(),
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Trust selector — width-safety wrapper is required:
                          `Select`'s wrapper span and inner <select> are both
                          `w-full`, so it needs a `w-fit` ancestor to avoid
                          stretching to fill this flex row. */}
                      {(() => {
                        const trustLevel = describeTrustLevel(agent.trust_level).level;
                        return (
                          <div
                            className="w-fit shrink-0"
                            title={t(`settings.agents.trustSummary.${trustLevel}`)}
                          >
                            <Select
                              size="sm"
                              value={agent.trust_level}
                              onChange={(e) =>
                                updateAgentMut.mutate({
                                  name: agent.name,
                                  updates: { trustLevel: e.target.value },
                                })
                              }
                            >
                              <option value="full">{t("settings.agents.trust.full")}</option>
                              <option value="review">{t("settings.agents.trust.review")}</option>
                              <option value="unknown">{t("settings.agents.trust.unknown")}</option>
                            </Select>
                          </div>
                        );
                      })()}
                      <Toggle
                        enabled={agent.enabled}
                        onToggle={() =>
                          updateAgentMut.mutate({
                            name: agent.name,
                            updates: { enabled: !agent.enabled },
                          })
                        }
                      />
                      <ConfirmActionButton
                        variant="ghost"
                        size="sm"
                        aria-label={t("settings.agents.deleteAgent", {
                          name: resolveAgentDisplayName(agent.name, agents),
                        })}
                        confirmLabel={t("settings.agents.confirm")}
                        cancelLabel={t("settings.agents.cancel")}
                        onConfirm={() => deleteAgentMut.mutate(agent.name)}
                      >
                        <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </ConfirmActionButton>
                    </div>
                  </div>
                </div>
              ))}
              {onSetupAgent && (
                <div className="px-3 py-2">
                  <Button variant="ghost" size="sm" onClick={onSetupAgent}>
                    {t("settings.agents.setupAnotherTool")}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
        {/* Trust legend — collapsed by default; native <details> keeps the
            keyboard/screen-reader contract for free. */}
        <details className="group px-1 pt-2">
          <summary
            className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--mem-radius-sm)] px-1 py-0.5 [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-[var(--mem-focus-ring)] focus-visible:outline-offset-2"
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-xs)",
              color: "var(--mem-text-tertiary)",
            }}
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3 shrink-0 transition-transform duration-[var(--mem-dur-fast)] group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {t("settings.agents.trustLevels")}
          </summary>
          <div className="flex flex-col gap-1.5 px-1 pt-2">
            {(Object.keys(TRUST_LEVELS) as Array<keyof typeof TRUST_LEVELS>).map((level) => (
              <div key={level} className="flex items-start gap-2">
                <span className="shrink-0">
                  <Tag tone="neutral">{t(`settings.agents.trust.${level}`)}</Tag>
                </span>
                <span
                  style={{
                    fontFamily: "var(--mem-font-body)",
                    fontSize: "var(--mem-text-sm)",
                    color: "var(--mem-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {t(`settings.agents.trustSummary.${level}`)}
                </span>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* ── Remote Access ─────────────────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "30ms" }}>
        <SectionHeader label={t("settings.agents.remoteAccess")} />
        <RemoteAccessPanel />
      </section>

      {/* ── Web — Claude.ai & ChatGPT ─────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "45ms" }}>
        <SectionHeader label={t("connectMatrix.webTitle")} />
        <WebPlatformCards />
      </section>

      {/* ── Apps & CLIs ───────────────────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "60ms" }}>
        <SectionHeader label={t("connectMatrix.appsTitle")} />
        <ClientSetupList />
      </section>
    </>
  );
}
