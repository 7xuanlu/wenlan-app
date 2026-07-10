// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getEntityDetail, getMemoryDetail } from "../../lib/tauri";
import { diffWords, diffWordCounts, type DiffSegment } from "../../lib/wordDiff";
import { reviewItemId, type ReviewItem } from "./useReviewQueue";

export function reviewKindLabel(t: TFunction, item: ReviewItem): string {
  if (item.kind === "revision") return t("review.kindRevision");
  if (item.kind === "capture") return t("review.kindCapture");
  switch (item.action) {
    case "entity_merge":
      return t("review.kindEntityMerge");
    case "detect_contradiction":
      return t("review.kindContradiction");
    case "dedup_merge":
      return t("review.kindDuplicate");
    case "relation_conflict":
      return t("review.kindRelationConflict");
    case "suggest_entity":
      return t("review.kindEntitySuggestion");
  }
}

export function truncateReviewText(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

const INS_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(140, 165, 130, 0.24)",
  textDecoration: "none",
  borderRadius: 3,
  padding: "0 2px",
};

const DEL_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(205, 92, 74, 0.18)",
  borderRadius: 3,
  padding: "0 2px",
};

const paneStyle: React.CSSProperties = {
  border: "1px solid var(--mem-border)",
  borderRadius: 10,
  backgroundColor: "var(--mem-detail-surface-raised)",
  padding: "13px 15px",
  fontFamily: "var(--mem-font-body)",
  fontSize: 14,
  lineHeight: 1.65,
  color: "var(--mem-text)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const paneLabelStyle: React.CSSProperties = {
  fontFamily: "var(--mem-font-body)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--mem-text-tertiary)",
  margin: "0 0 7px",
};

const actionButtonStyle: React.CSSProperties = {
  fontFamily: "var(--mem-font-body)",
  fontSize: 13.5,
  borderRadius: 8,
  padding: "8px 15px",
  cursor: "pointer",
  border: "1px solid var(--mem-border)",
  backgroundColor: "var(--mem-surface)",
  color: "var(--mem-text)",
};

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "ins" ? (
          <ins key={index} style={INS_STYLE}>
            {segment.text}
          </ins>
        ) : segment.kind === "del" ? (
          <del key={index} style={DEL_STYLE}>
            {segment.text}
          </del>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

interface ReviewDialogProps {
  items: ReviewItem[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onResolve: (args: { item: ReviewItem; approve: boolean }) => Promise<unknown>;
  isResolving: boolean;
  onOpenMemory?: (sourceId: string) => void;
}

export default function ReviewDialog({
  items,
  openId,
  onOpenChange,
  onResolve,
  isResolving,
  onOpenMemory,
}: ReviewDialogProps) {
  const { t } = useTranslation();
  const [showDone, setShowDone] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const open = openId != null;
  const foundIndex = items.findIndex((entry) => reviewItemId(entry) === openId);
  const index = foundIndex >= 0 ? foundIndex : items.length > 0 ? 0 : -1;
  const item = showDone ? null : index >= 0 ? items[index] : null;
  const done = open && (showDone || items.length === 0);

  const detailSourceId =
    item?.kind === "revision"
      ? item.targetSourceId
      : item?.kind === "capture"
        ? item.id
        : null;
  const target = useQuery({
    queryKey: ["memory-detail", detailSourceId],
    queryFn: () => getMemoryDetail(detailSourceId as string),
    enabled: detailSourceId != null,
  });

  const memoryPaneIds =
    item?.kind === "refinement" && item.action !== "entity_merge"
      ? item.sourceIds.slice(0, 2)
      : [];
  const memoryPaneA = useQuery({
    queryKey: ["memory-detail", memoryPaneIds[0] ?? null],
    queryFn: () => getMemoryDetail(memoryPaneIds[0]),
    enabled: memoryPaneIds.length > 0,
  });
  const memoryPaneB = useQuery({
    queryKey: ["memory-detail", memoryPaneIds[1] ?? null],
    queryFn: () => getMemoryDetail(memoryPaneIds[1]),
    enabled: memoryPaneIds.length > 1,
  });

  const mergePayload =
    item?.kind === "refinement" && item.payload?.action === "entity_merge"
      ? item.payload
      : null;
  const mergeExisting = useQuery({
    queryKey: ["entity-detail", mergePayload?.existing_id ?? null],
    queryFn: () => getEntityDetail(mergePayload?.existing_id as string),
    enabled: mergePayload != null,
  });
  const mergeIncoming = useQuery({
    queryKey: ["entity-detail", mergePayload?.new_id ?? null],
    queryFn: () => getEntityDetail(mergePayload?.new_id as string),
    enabled: mergePayload != null,
  });

  const beforeContent = target.data?.content ?? "";
  const segments = useMemo(
    () =>
      item?.kind === "revision" && target.data
        ? diffWords(beforeContent, item.content)
        : [],
    [item, target.data, beforeContent],
  );
  const wordCounts = useMemo(() => diffWordCounts(segments), [segments]);

  const isContradiction =
    item?.kind === "refinement" && item.action === "detect_contradiction";
  // Daemon order: source_ids[0] is the new memory, source_ids[1] the existing
  // one — so pane A holds "after" and pane B holds "before".
  const contradictionSegments = useMemo(
    () =>
      isContradiction && memoryPaneA.data && memoryPaneB.data
        ? diffWords(memoryPaneB.data.content, memoryPaneA.data.content)
        : [],
    [isContradiction, memoryPaneA.data, memoryPaneB.data],
  );

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open, openId]);

  const resolveCurrent = async (approve: boolean) => {
    if (!item || isResolving) return;
    const isCapture = item.kind === "capture";
    const isConflict =
      item.kind === "refinement" && item.action === "detect_contradiction";
    const next = items[index + 1] ?? (index > 0 ? items[index - 1] : null);
    await onResolve({ item, approve });
    setFlash(
      approve
        ? t(
            isCapture
              ? "review.confirmed"
              : isConflict
                ? "review.resolved"
                : "review.approved",
          )
        : t(
            isCapture
              ? "review.forgotten"
              : isConflict
                ? "review.keptBoth"
                : "review.dismissed",
          ),
    );
    window.setTimeout(() => setFlash(null), 450);
    if (next) onOpenChange(reviewItemId(next));
    else setShowDone(true);
  };

  const goTo = (offset: number) => {
    if (items.length === 0) return;
    const nextIndex = (index + offset + items.length) % items.length;
    onOpenChange(reviewItemId(items[nextIndex]));
  };

  const close = () => {
    setShowDone(false);
    onOpenChange(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      switch (event.key) {
        case "Escape":
          close();
          break;
        case "Enter":
          event.preventDefault();
          void resolveCurrent(true);
          break;
        case "d":
        case "D":
          void resolveCurrent(false);
          break;
        case "ArrowRight":
          goTo(1);
          break;
        case "ArrowLeft":
          goTo(-1);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!open) return null;

  const heading = done
    ? t("review.allCaughtUp")
    : item?.kind === "revision"
      ? (target.data?.title?.trim() ||
        truncateReviewText(item.content, 72))
      : item?.kind === "capture"
        ? truncateReviewText(item.title, 72)
        : item
          ? reviewKindLabel(t, item)
          : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("review.title")}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "6vh 16px 16px",
        backgroundColor: "rgba(0,0,0,0.45)",
        zIndex: 1100,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          position: "relative",
          width: "min(760px, 100%)",
          maxHeight: "86vh",
          overflowY: "auto",
          backgroundColor: "var(--mem-surface)",
          border: "1px solid var(--mem-border)",
          borderRadius: 16,
          boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
          outline: "none",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {flash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              backgroundColor: "var(--mem-surface)",
              borderRadius: 16,
              zIndex: 3,
              fontFamily: "var(--mem-font-heading)",
              fontSize: 19,
              color: "var(--mem-status-success-text)",
            }}
          >
            {flash} ✓
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 20px 14px",
            borderBottom: "1px solid var(--mem-detail-divider)",
          }}
        >
          {item && (
            <span
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: 11,
                letterSpacing: "0.04em",
                borderRadius: 5,
                padding: "2px 8px",
                color: "var(--mem-accent-indigo)",
                backgroundColor: "var(--mem-indigo-bg)",
              }}
            >
              {reviewKindLabel(t, item)}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--mem-font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: 12,
              color: "var(--mem-text-tertiary)",
            }}
          >
            {item
              ? t("review.progress", {
                  position: index + 1,
                  total: items.length,
                })
              : ""}
          </span>
          <button
            type="button"
            aria-label={t("review.close")}
            onClick={close}
            style={{
              background: "none",
              border: "none",
              color: "var(--mem-text-tertiary)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 6,
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {done ? (
          <div style={{ textAlign: "center", padding: "40px 24px 44px" }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                margin: "0 auto 16px",
                backgroundColor: "var(--mem-status-success-bg)",
                color: "var(--mem-status-success-text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              ✓
            </div>
            <h3
              style={{
                fontFamily: "var(--mem-font-heading)",
                fontWeight: 500,
                fontSize: 20,
                margin: "0 0 6px",
                color: "var(--mem-text)",
              }}
            >
              {t("review.allCaughtUp")}
            </h3>
            <p
              style={{
                fontFamily: "var(--mem-font-body)",
                color: "var(--mem-text-secondary)",
                fontSize: 13.5,
                margin: "0 0 20px",
              }}
            >
              {t("review.emptyQueueHint")}
            </p>
            <button
              type="button"
              onClick={close}
              style={{
                ...actionButtonStyle,
                backgroundColor: "var(--mem-accent-indigo)",
                borderColor: "var(--mem-accent-indigo)",
                color: "var(--mem-bg)",
                fontWeight: 600,
              }}
            >
              {t("review.backToReview")}
            </button>
          </div>
        ) : item ? (
          <>
            <div style={{ padding: "20px 22px 8px" }}>
              <h3
                style={{
                  fontFamily: "var(--mem-font-heading)",
                  fontWeight: 500,
                  fontSize: 19,
                  margin: "0 0 3px",
                  color: "var(--mem-text)",
                }}
              >
                {heading}
              </h3>
              <p
                style={{
                  fontFamily: "var(--mem-font-body)",
                  color: "var(--mem-text-tertiary)",
                  fontSize: 12.5,
                  margin: "0 0 18px",
                }}
              >
                {item.kind === "revision"
                  ? item.agent
                    ? t("review.proposedBy", { agent: item.agent })
                    : ""
                  : item.kind === "capture"
                    ? t("review.captureHint")
                    : isContradiction
                      ? t("review.contradictionHint")
                      : t("review.confidence", {
                          percent: Math.round(item.confidence * 100),
                        })}
              </p>

              {item.kind === "revision" && (
                <>
                  <div
                    role="tablist"
                    style={{
                      display: "inline-flex",
                      border: "1px solid var(--mem-border)",
                      borderRadius: 8,
                      overflow: "hidden",
                      marginBottom: 14,
                    }}
                  >
                    {[
                      { side: false, label: t("review.unified") },
                      { side: true, label: t("review.sideBySide") },
                    ].map(({ side, label }) => (
                      <button
                        key={label}
                        type="button"
                        role="tab"
                        aria-selected={sideBySide === side}
                        onClick={() => setSideBySide(side)}
                        style={{
                          fontFamily: "var(--mem-font-body)",
                          fontSize: 12.5,
                          padding: "5px 12px",
                          border: "none",
                          cursor: "pointer",
                          backgroundColor:
                            sideBySide === side
                              ? "var(--mem-indigo-bg)"
                              : "var(--mem-surface)",
                          color:
                            sideBySide === side
                              ? "var(--mem-accent-indigo)"
                              : "var(--mem-text-secondary)",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {target.isLoading ? (
                    <div style={paneStyle}>{t("review.loadingCurrent")}</div>
                  ) : sideBySide ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <p style={paneLabelStyle}>{t("review.current")}</p>
                        <div style={paneStyle}>
                          <DiffText
                            segments={segments.filter(
                              (segment) => segment.kind !== "ins",
                            )}
                          />
                        </div>
                      </div>
                      <div>
                        <p style={paneLabelStyle}>{t("review.proposed")}</p>
                        <div style={paneStyle}>
                          <DiffText
                            segments={segments.filter(
                              (segment) => segment.kind !== "del",
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={paneStyle}>
                      <DiffText segments={segments} />
                    </div>
                  )}

                  {!target.isLoading && (
                    <p
                      style={{
                        fontFamily: "var(--mem-font-body)",
                        color: "var(--mem-text-tertiary)",
                        fontSize: 12,
                        margin: "10px 2px 0",
                      }}
                    >
                      {t("review.wordDelta", {
                        added: wordCounts.added,
                        removed: wordCounts.removed,
                      })}
                      {" · "}
                      <del style={DEL_STYLE}>{t("review.stripped")}</del>
                      {" · "}
                      <ins style={INS_STYLE}>{t("review.added")}</ins>
                    </p>
                  )}
                </>
              )}

              {item.kind === "capture" && (
                <div style={paneStyle}>
                  {target.isLoading
                    ? t("review.loadingCurrent")
                    : (target.data?.content ?? item.snippet ?? "")}
                </div>
              )}

              {item.kind === "refinement" &&
                item.action === "entity_merge" && (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div>
                      <p style={paneLabelStyle}>{t("review.mergeKeep")}</p>
                      <div style={paneStyle}>
                        {mergeExisting.data?.entity.name ??
                          mergePayload?.existing_id}
                      </div>
                    </div>
                    <div>
                      <p style={paneLabelStyle}>{t("review.mergeFoldsIn")}</p>
                      <div style={paneStyle}>
                        {mergeIncoming.data?.entity.name ??
                          mergePayload?.new_id}
                      </div>
                    </div>
                  </div>
                )}

              {item.kind === "refinement" &&
                item.action === "detect_contradiction" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <p style={paneLabelStyle}>{t("review.existingMemory")}</p>
                      <div style={paneStyle}>
                        {memoryPaneB.isLoading ? (
                          t("review.loadingCurrent")
                        ) : contradictionSegments.length > 0 ? (
                          <DiffText
                            segments={contradictionSegments.filter(
                              (segment) => segment.kind !== "ins",
                            )}
                          />
                        ) : (
                          (memoryPaneB.data?.content ?? "")
                        )}
                      </div>
                    </div>
                    <div>
                      <p style={paneLabelStyle}>{t("review.newMemoryNewer")}</p>
                      <div style={paneStyle}>
                        {memoryPaneA.isLoading ? (
                          t("review.loadingCurrent")
                        ) : contradictionSegments.length > 0 ? (
                          <DiffText
                            segments={contradictionSegments.filter(
                              (segment) => segment.kind !== "del",
                            )}
                          />
                        ) : (
                          (memoryPaneA.data?.content ?? "")
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {item.kind === "refinement" &&
                item.action !== "entity_merge" &&
                item.action !== "detect_contradiction" && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {item.action === "suggest_entity" &&
                      item.payload?.action === "suggest_entity" &&
                      item.payload.name_hint && (
                        <div style={paneStyle}>{item.payload.name_hint}</div>
                      )}
                    {[memoryPaneA, memoryPaneB].map(
                      (pane, paneIndex) =>
                        memoryPaneIds[paneIndex] && (
                          <div key={paneIndex}>
                            <p style={paneLabelStyle}>
                              {pane.data?.title ?? ""}
                            </p>
                            <div style={paneStyle}>
                              {pane.isLoading
                                ? t("review.loadingCurrent")
                                : (pane.data?.content ?? "")}
                            </div>
                          </div>
                        ),
                    )}
                  </div>
                )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px 16px",
                borderTop: "1px solid var(--mem-detail-divider)",
                marginTop: 14,
              }}
            >
              <button
                type="button"
                disabled={isResolving}
                onClick={() => void resolveCurrent(false)}
                style={{ ...actionButtonStyle, color: "var(--mem-accent-warm)" }}
              >
                {item.kind === "capture"
                  ? t("review.forget")
                  : isContradiction
                    ? t("review.keepBoth")
                    : t("review.dismiss")}
              </button>
              {(item.kind === "revision" || item.kind === "capture") &&
                onOpenMemory && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenMemory(
                        item.kind === "revision" ? item.targetSourceId : item.id,
                      )
                    }
                    style={actionButtonStyle}
                  >
                    {t("review.openMemory")}
                  </button>
                )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={items.length < 2}
                onClick={() => goTo(1)}
                style={actionButtonStyle}
              >
                {t("review.skip")}
              </button>
              <button
                type="button"
                disabled={isResolving}
                onClick={() => void resolveCurrent(true)}
                style={{
                  ...actionButtonStyle,
                  backgroundColor: "var(--mem-accent-indigo)",
                  borderColor: "var(--mem-accent-indigo)",
                  color: "var(--mem-bg)",
                  fontWeight: 600,
                }}
              >
                {item.kind === "capture"
                  ? t("review.confirm")
                  : isContradiction
                    ? t("review.resolve")
                    : t("review.approve")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
