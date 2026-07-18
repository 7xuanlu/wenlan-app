// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getEntityDetail,
  updateObservation,
  deleteObservation,
  addObservation,
  confirmObservation,
  confirmEntity,
  deleteEntity,
  search,
  FACET_COLORS,
  type Observation,
  type RelationWithEntity,
} from "../../lib/tauri";
import { MetadataRow, RailPanelTitle } from "./MemoryDetailPrimitives";
import FocusGraph from "./FocusGraph";
import AtlasView from "./AtlasView";
import { slotForEntityType } from "../../lib/graph/palette";

interface EntityDetailProps {
  entityId: string;
  onBack: () => void;
  onEntityClick: (entityId: string) => void;
  onMemoryClick?: (sourceId: string) => void;
}

function timeAgo(ts: number, locale: string): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return formatter.format(-diff, "second");
  if (diff < 3600) return formatter.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return formatter.format(-Math.floor(diff / 3600), "hour");
  if (diff < 604800) return formatter.format(-Math.floor(diff / 86400), "day");
  return new Date(ts * 1000).toLocaleDateString(locale);
}

function absoluteDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function monogram(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function EntityDetail({ entityId, onBack, onEntityClick, onMemoryClick }: EntityDetailProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [editingObs, setEditingObs] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [newObs, setNewObs] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  // Resets to "focus" every time the overlay opens — no persistence across opens.
  const [overlayMode, setOverlayMode] = useState<"focus" | "map">("focus");
  // Artifact screen 02's "Show verbs" chip — on by default, reset on open.
  const [showVerbs, setShowVerbs] = useState(true);
  // Set when Escape cancels an edit, so the unmount blur doesn't save the draft
  const cancelEditRef = useRef(false);

  useEffect(() => {
    if (!graphOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase: wins the race against Main's window listener,
        // which treats Escape as "back" while view.kind === "entity".
        e.stopPropagation();
        setGraphOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [graphOpen]);

  const locale = i18n.resolvedLanguage ?? i18n.language;

  const { data: detail, isError, refetch } = useQuery({
    queryKey: ["entityDetail", entityId],
    queryFn: () => getEntityDetail(entityId),
    refetchInterval: 5000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["entityDetail", entityId] });
    queryClient.invalidateQueries({ queryKey: ["entities"] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      updateObservation(id, content),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteObservation(id),
    onSuccess: invalidate,
  });

  const addMutation = useMutation({
    mutationFn: (content: string) => addObservation(entityId, content, "human", 1.0),
    onSuccess: () => {
      setNewObs("");
      setShowAddForm(false);
      invalidate();
    },
  });

  const confirmObsMutation = useMutation({
    mutationFn: ({ id, confirmed }: { id: string; confirmed: boolean }) =>
      confirmObservation(id, confirmed),
    onSuccess: invalidate,
  });

  const confirmEntityMutation = useMutation({
    mutationFn: (confirmed: boolean) => confirmEntity(entityId, confirmed),
    onSuccess: invalidate,
  });

  const deleteEntityMutation = useMutation({
    mutationFn: () => deleteEntity(entityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["constellation-entities"] });
      onBack();
    },
  });

  // Appears in: recall-matched memories. Heuristic (name search + score
  // filter) until the daemon exposes memory_entities on the detail route.
  const { data: linkedMemories = [] } = useQuery({
    queryKey: ["entity-linked-memories", entityId, detail?.entity?.name],
    queryFn: async () => {
      if (!detail?.entity?.name) return [];
      const results = await search(detail.entity.name, 10, "memory");
      return results.filter((r) => r.entity_id === entityId || r.score > 0.7).slice(0, 8);
    },
    enabled: !!detail?.entity?.name,
    staleTime: 30000,
  });

  // Deduplicate observations by content (safety net for DB-level dupes)
  const observations = useMemo(
    () =>
      (detail?.observations ?? []).filter(
        (obs, i, arr) =>
          arr.findIndex((o) => o.content.toLowerCase() === obs.content.toLowerCase()) === i,
      ),
    [detail?.observations],
  );

  // Ledger shows raw relation records (curation needs to see duplicates); the
  // graph (FocusGraph) does its own aggregation from the GraphModel.
  const relations = useMemo(() => detail?.relations ?? [], [detail?.relations]);

  const sortedRelations = useMemo(
    () =>
      [...relations].sort((a, b) =>
        a.direction === b.direction
          ? a.relation_type.localeCompare(b.relation_type)
          : a.direction === "outgoing"
            ? -1
            : 1,
      ),
    [relations],
  );

  // Overlay toolbar count: distinct neighbor entities, self-loops excluded —
  // an entity related both ways still counts once.
  const neighborCount = useMemo(
    () => new Set(relations.filter((r) => r.entity_id !== entityId).map((r) => r.entity_id)).size,
    [relations, entityId],
  );

  if (!detail) {
    return (
      <main className="memory-detail-dossier" aria-label={t("entityDetail.dossierLabel")}>
        <header className="entity-dossier-header">
          <button
            type="button"
            onClick={onBack}
            className="memory-detail-back"
            aria-label={t("entityDetail.back")}
            title={t("entityDetail.back")}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
        </header>
        <div className="entity-detail-status" role="status">
          {isError ? (
            <>
              <p className="entity-empty">{t("entityDetail.loadError")}</p>
              <button type="button" className="memory-detail-text-button" onClick={() => refetch()}>
                {t("entityDetail.retry")}
              </button>
            </>
          ) : (
            <p className="entity-empty">{t("entityDetail.loading")}</p>
          )}
        </div>
      </main>
    );
  }

  const { entity } = detail;
  const space = entity.space ?? entity.domain;

  const startEdit = (obs: Observation) => {
    setEditingObs(obs.id);
    setEditContent(obs.content);
  };

  const saveEdit = (id: string) => {
    if (updateMutation.isPending) return;
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === observations.find((o) => o.id === id)?.content) {
      setEditingObs(null);
      return;
    }
    // Stay in edit mode until the write lands, so a failure keeps the draft
    updateMutation.mutate({ id, content: trimmed }, { onSuccess: () => setEditingObs(null) });
  };

  const relationRow = (rel: RelationWithEntity) => (
    <button
      key={rel.id}
      type="button"
      className="entity-relation-row"
      onClick={() => onEntityClick(rel.entity_id)}
    >
      <span className="entity-relation-verb">
        {rel.direction === "incoming" ? `← ${rel.relation_type}` : `${rel.relation_type} →`}
      </span>
      <span className="entity-relation-name">{rel.entity_name}</span>
      <span className="entity-relation-type">{rel.entity_type}</span>
    </button>
  );

  return (
    <>
    <main className="memory-detail-dossier" aria-label={t("entityDetail.dossierLabel")}>
      <header className="entity-dossier-header">
        <button
          type="button"
          onClick={onBack}
          className="memory-detail-back"
          aria-label={t("entityDetail.back")}
          title={t("entityDetail.back")}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div className="entity-dossier-hero">
          <div className="entity-dossier-hero-row">
            <div className="entity-detail-head">
              <div className="entity-detail-seal" aria-hidden="true">
                {monogram(entity.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="memory-detail-title">{entity.name}</h2>
                <span className="memory-detail-timestamp" title={absoluteDate(entity.updated_at)}>
                  {entity.entity_type}
                  {space ? ` · ${space}` : ""}
                  {` · ${timeAgo(entity.updated_at, locale)}`}
                </span>
              </div>
            </div>
            <div className="memory-detail-actions">
              {(confirmEntityMutation.isError || deleteEntityMutation.isError) && (
                <span className="entity-error" role="alert">{t("entityDetail.saveError")}</span>
              )}
              <button
                type="button"
                disabled={confirmEntityMutation.isPending}
                onClick={() => confirmEntityMutation.mutate(!entity.confirmed)}
                className={`memory-detail-chip entity-status-chip ${entity.confirmed ? "success" : "warning"}`}
                title={entity.confirmed ? t("entityDetail.markUnconfirmed") : t("entityDetail.confirmEntity")}
              >
                {entity.confirmed ? t("entityDetail.confirmed") : t("entityDetail.confirmEntity")}
              </button>
              {confirmDelete ? (
                <>
                  <span className="entity-delete-question">{t("entityDetail.deleteQuestion")}</span>
                  <button
                    type="button"
                    disabled={deleteEntityMutation.isPending}
                    onClick={() => deleteEntityMutation.mutate()}
                    className="entity-delete-confirm"
                  >
                    {t("entityDetail.delete")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="memory-detail-text-button"
                  >
                    {t("entityDetail.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="memory-detail-icon-button memory-detail-delete"
                  aria-label={t("entityDetail.deleteEntity")}
                  title={t("entityDetail.deleteEntity")}
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="memory-detail-grid">
        <section className="memory-detail-reading space-y-4" aria-label={t("entityDetail.readingLabel")}>
          {/* About: agent-recorded notes, curated here */}
          <div className="memory-detail-card">
            <div className="memory-detail-card-header">
              <h3 className="memory-detail-section-title">{t("entityDetail.aboutTitle")}</h3>
              {!showAddForm && (
                <button
                  type="button"
                  className="memory-detail-text-button"
                  onClick={() => setShowAddForm(true)}
                >
                  {t("entityDetail.addNote")}
                </button>
              )}
            </div>
            <div className="memory-detail-card-body">
              {(updateMutation.isError ||
                deleteMutation.isError ||
                addMutation.isError ||
                confirmObsMutation.isError) && (
                <p className="entity-error" role="alert">{t("entityDetail.saveError")}</p>
              )}
              {observations.length === 0 && !showAddForm && (
                <p className="entity-empty">{t("entityDetail.emptyAbout")}</p>
              )}
              <div className="entity-obs-list">
                {observations.map((obs) => (
                  <div key={obs.id} className="entity-obs-row">
                    <button
                      type="button"
                      className="memory-detail-state-button entity-obs-state"
                      onClick={() => confirmObsMutation.mutate({ id: obs.id, confirmed: !obs.confirmed })}
                      aria-label={obs.confirmed ? t("entityDetail.unconfirmObservation") : t("entityDetail.confirmObservation")}
                      title={obs.confirmed ? t("entityDetail.unconfirmObservation") : t("entityDetail.confirmObservation")}
                    >
                      <span className={`memory-detail-state-dot ${obs.confirmed ? "is-on" : ""}`} />
                    </button>
                    {editingObs === obs.id ? (
                      <input
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onBlur={() => {
                          if (cancelEditRef.current) {
                            cancelEditRef.current = false;
                            return;
                          }
                          saveEdit(obs.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(obs.id);
                          if (e.key === "Escape") {
                            // Stop it here: Main's window listener treats Escape as "back"
                            e.stopPropagation();
                            cancelEditRef.current = true;
                            setEditingObs(null);
                          }
                        }}
                        autoFocus
                        disabled={updateMutation.isPending}
                        className="entity-obs-input"
                        aria-label={t("entityDetail.editNote")}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`entity-obs-content ${obs.confirmed ? "" : "is-unconfirmed"}`}
                        onClick={() => startEdit(obs)}
                        title={obs.source_agent ? `${t("entityDetail.editNote")} · ${obs.source_agent}` : t("entityDetail.editNote")}
                      >
                        {obs.content}
                      </button>
                    )}
                    {obs.confidence != null && (
                      <span className="entity-obs-confidence">{obs.confidence.toFixed(1)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(obs.id)}
                      className="entity-obs-delete"
                      aria-label={t("entityDetail.deleteNote")}
                      title={t("entityDetail.deleteNote")}
                    >
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {showAddForm && (
                  <div className="entity-obs-add">
                    <input
                      value={newObs}
                      onChange={(e) => setNewObs(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newObs.trim() && !addMutation.isPending)
                          addMutation.mutate(newObs.trim());
                        if (e.key === "Escape") {
                          // Stop it here: Main's window listener treats Escape as "back"
                          e.stopPropagation();
                          setShowAddForm(false);
                          setNewObs("");
                        }
                      }}
                      placeholder={t("entityDetail.notePlaceholder", { name: entity.name })}
                      autoFocus
                      disabled={addMutation.isPending}
                      className="entity-obs-input"
                      aria-label={t("entityDetail.addNote")}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Connections: one-hop map + relation ledger */}
          <div className="memory-detail-card">
            <div className="memory-detail-card-header">
              <h3 className="memory-detail-section-title">{t("entityDetail.connectionsTitle")}</h3>
              <div className="memory-detail-actions">
                {relations.length > 0 && <span className="entity-count">{relations.length}</span>}
                <button
                  type="button"
                  onClick={() => {
                    setOverlayMode("focus");
                    setShowVerbs(true);
                    setGraphOpen(true);
                  }}
                  className="memory-detail-icon-button"
                  aria-label={t("entityDetail.expandGraph")}
                  title={t("entityDetail.expandGraph")}
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="memory-detail-card-body">
              {relations.length === 0 ? (
                <p className="entity-empty">{t("entityDetail.emptyConnections")}</p>
              ) : (
                <>
                  <FocusGraph detail={detail} onEntityClick={onEntityClick} />
                  <div className="entity-relation-list">{sortedRelations.map(relationRow)}</div>
                </>
              )}
            </div>
          </div>
        </section>

        <aside className="memory-detail-context" aria-label={t("entityDetail.contextLabel")}>
          <section className="memory-detail-rail-panel memory-detail-metadata-panel">
            <RailPanelTitle>{t("entityDetail.detailsTitle")}</RailPanelTitle>
            <div className="memory-detail-metadata-list">
              <MetadataRow label={t("entityDetail.typeLabel")}>
                <span className="entity-meta-mono">{entity.entity_type}</span>
              </MetadataRow>
              {space && (
                <MetadataRow label={t("entityDetail.spaceLabel")}>
                  <span className="entity-meta-mono">{space}</span>
                </MetadataRow>
              )}
              <MetadataRow label={t("entityDetail.statusLabel")}>
                <span className={`memory-detail-chip ${entity.confirmed ? "success" : "warning"}`}>
                  {entity.confirmed ? t("entityDetail.confirmed") : t("entityDetail.unconfirmed")}
                </span>
              </MetadataRow>
              {entity.confidence != null && (
                <MetadataRow label={t("entityDetail.confidenceLabel")}>
                  <span className="entity-meta-mono">{entity.confidence.toFixed(2)}</span>
                </MetadataRow>
              )}
              {entity.source_agent && (
                <MetadataRow label={t("entityDetail.sourceLabel")}>
                  <span className="entity-meta-mono">{entity.source_agent}</span>
                </MetadataRow>
              )}
              <MetadataRow label={t("entityDetail.firstSeen")}>
                <span className="entity-meta-mono" title={absoluteDate(entity.created_at)}>
                  {new Date(entity.created_at * 1000).toLocaleDateString(locale)}
                </span>
              </MetadataRow>
              <MetadataRow label={t("entityDetail.updatedLabel")}>
                <span className="entity-meta-mono" title={absoluteDate(entity.updated_at)}>
                  {timeAgo(entity.updated_at, locale)}
                </span>
              </MetadataRow>
            </div>
          </section>
        </aside>

        {linkedMemories.length > 0 && (
          <div className="memory-detail-context-dock">
            <section className="memory-detail-rail-panel memory-detail-secondary-panel">
              <div className="memory-detail-panel-heading">
                <h3 className="memory-detail-rail-title">{t("entityDetail.appearsTitle")}</h3>
                <span className="entity-appears-hint">{t("entityDetail.appearsHint")}</span>
              </div>
              <div className="memory-detail-related-grid">
                {linkedMemories.map((mem) => {
                  const facet = mem.memory_type ?? null;
                  const facetClass = facet ? FACET_COLORS[facet] : null;
                  return (
                    <button
                      key={mem.id}
                      type="button"
                      className="memory-detail-related-card"
                      onClick={() => onMemoryClick?.(mem.source_id)}
                    >
                      <span className="memory-detail-context-row-body">
                        <span className="memory-detail-related-copy line-clamp-2">{mem.content}</span>
                        <span className="memory-detail-related-meta">
                          {facet && facetClass && (
                            <span className={`memory-detail-related-facet border ${facetClass}`}>{facet}</span>
                          )}
                          {mem.is_archived && <span>{t("entityDetail.archived")}</span>}
                        </span>
                      </span>
                      <svg
                        className="memory-detail-related-chevron"
                        aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
    {graphOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("entityDetail.expandGraph")}
        className="fixed inset-0 z-50"
        style={{
          background: "var(--mem-bg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Artifact screen 02 toolbar: crumb ▸ chip · count · Atlas|Focus
            segment. The close button lives in-row (left) so nothing floats
            over the graph. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--mem-border)",
            background: "var(--mem-surface)",
            fontFamily: "var(--mem-font-body)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setGraphOpen(false)}
            className="memory-detail-icon-button"
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <span style={{ fontSize: 12, color: "var(--mem-text-tertiary)" }}>
            {t("focus.crumbAtlas")}
            {overlayMode === "focus" && (
              <>
                {" ▸ "}
                <b style={{ color: "var(--mem-text)", fontWeight: 500 }}>
                  {t("focus.crumbFocus", { name: entity.name })}
                </b>
              </>
            )}
          </span>
          {overlayMode === "focus" && (
            <button
              type="button"
              aria-pressed={showVerbs}
              onClick={() => setShowVerbs((v) => !v)}
              style={{
                fontSize: 12,
                color: showVerbs ? "var(--mem-text)" : "var(--mem-text-secondary)",
                border: `1px solid ${showVerbs ? "var(--mem-distilled-border)" : "var(--mem-border)"}`,
                borderRadius: "var(--mem-radius-full)",
                padding: "4px 12px",
                background: showVerbs ? "var(--mem-indigo-bg)" : "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("focus.showVerbs")}
            </button>
          )}
          {overlayMode === "focus" && (
            <span
              style={{
                marginLeft: "auto",
                font: "400 11px var(--mem-font-mono)",
                color: "var(--mem-text-tertiary)",
              }}
            >
              {t("focus.neighbors", { count: neighborCount })}
              {linkedMemories.length > 0 &&
                ` · ${t("focus.memoriesCount", { count: linkedMemories.length })}`}
            </span>
          )}
          <div
            role="group"
            aria-label={t("focus.viewSegmentLabel")}
            style={{
              display: "flex",
              border: "1px solid var(--mem-border)",
              borderRadius: "var(--mem-radius-md)",
              overflow: "hidden",
              marginLeft: overlayMode === "focus" ? 0 : "auto",
            }}
          >
            {(["map", "focus"] as const).map((mode) => {
              const on = overlayMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOverlayMode(mode)}
                  style={{
                    fontSize: 12,
                    padding: "4px 14px",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: on ? "var(--mem-text)" : "var(--mem-text-tertiary)",
                    fontWeight: on ? 500 : 400,
                    background: on ? "var(--mem-hover-strong)" : "transparent",
                  }}
                >
                  {mode === "map" ? t("focus.segAtlas") : t("focus.segFocus")}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            // Artifact screen 02 focusgrid: stage + 300px entity panel.
            ...(overlayMode === "focus"
              ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px" }
              : {}),
          }}
        >
          {overlayMode === "focus" ? (
            <>
              <div style={{ position: "relative", minWidth: 0 }}>
                <FocusGraph
                  detail={detail}
                  onEntityClick={(id) => {
                    setGraphOpen(false);
                    onEntityClick(id);
                  }}
                  fill
                  showVerbs={showVerbs}
                  memoriesCount={linkedMemories.length}
                />
              </div>
              <aside
                aria-label={t("focus.panelLabel")}
                style={{
                  borderLeft: "1px solid var(--mem-border)",
                  background: "var(--mem-surface)",
                  padding: 18,
                  overflowY: "auto",
                  fontFamily: "var(--mem-font-body)",
                }}
              >
                <div
                  style={{
                    font: "500 10px var(--mem-font-mono)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--mem-text-tertiary)",
                  }}
                >
                  <i
                    aria-hidden="true"
                    style={{ color: `var(--kg-${slotForEntityType(entity.entity_type)})`, fontStyle: "normal" }}
                  >
                    ●
                  </i>
                  {` ${entity.entity_type} · ${entity.confirmed ? t("focus.confirmedState") : t("focus.unconfirmedState")}`}
                </div>
                <h4 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 2px", color: "var(--mem-text)" }}>
                  {entity.name}
                </h4>
                <div style={{ fontSize: 12, color: "var(--mem-text-tertiary)" }}>
                  {t("focus.observations", { count: detail.observations.length })}
                  {` · ${t("focus.relations", { count: detail.relations.length })}`}
                  {` · ${t("focus.updatedAgo", { ago: timeAgo(entity.updated_at, locale) })}`}
                </div>
                <hr style={{ border: "none", borderTop: "1px solid var(--mem-detail-divider)", margin: "14px 0" }} />
                <div>
                  {detail.relations.map((rel) => (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => {
                        setGraphOpen(false);
                        onEntityClick(rel.entity_id);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        padding: "5px 0",
                        fontSize: 12.5,
                        width: "100%",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "var(--mem-radius-full)",
                          flex: "none",
                          alignSelf: "center",
                          background: `var(--kg-${slotForEntityType(rel.entity_type)})`,
                        }}
                      />
                      <code
                        style={{
                          font: "500 10px var(--mem-font-mono)",
                          color: "var(--mem-text-tertiary)",
                          letterSpacing: "0.04em",
                          minWidth: 96,
                        }}
                      >
                        {rel.direction === "incoming" ? `${rel.relation_type} ←` : `${rel.relation_type} →`}
                      </code>
                      <span style={{ color: "var(--mem-text)" }}>{rel.entity_name}</span>
                    </button>
                  ))}
                </div>
                <hr style={{ border: "none", borderTop: "1px solid var(--mem-detail-divider)", margin: "14px 0" }} />
                <button
                  type="button"
                  onClick={() => setGraphOpen(false)}
                  style={{
                    display: "inline-block",
                    font: "500 12.5px var(--mem-font-body)",
                    color: "var(--mem-text)",
                    background: "var(--mem-indigo-bg)",
                    border: "1px solid var(--mem-distilled-border)",
                    borderRadius: "var(--mem-radius-md)",
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  {t("focus.openEntity")}
                </button>
              </aside>
            </>
          ) : (
            <AtlasView
              focusEntityId={entity.id}
              onNodeClick={(id) => {
                setGraphOpen(false);
                onEntityClick(id);
              }}
            />
          )}
        </div>
      </div>
    )}
    </>
  );
}
