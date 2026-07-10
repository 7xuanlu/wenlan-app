// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  distillReview,
  type DistillPendingCluster,
  type DistillReviewResponse,
} from "../../lib/tauri";
import ReviewDialog, { reviewKindLabel, truncateReviewText } from "./ReviewDialog";
import { reviewItemId, useReviewQueue, type ReviewItem } from "./useReviewQueue";

interface DistillReviewPanelProps {
  onBack: () => void;
  onPageClick: (pageId: string) => void;
  onMemoryClick?: (sourceId: string) => void;
}

function truncateText(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max <= 3) return ".".repeat(max);
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function pendingLabel(cluster: DistillPendingCluster): string {
  const fromContent = firstNonEmpty(cluster.contents);
  return (
    firstNonEmpty([
      cluster.existing_page_title,
      cluster.entity_name,
      cluster.space,
      fromContent ? truncateText(fromContent, 72) : null,
    ]) ?? "Untitled cluster"
  );
}

function sourceCountLabel(cluster: DistillPendingCluster): string {
  const newCount = cluster.new_memory_count;
  if (newCount != null) {
    return newCount === 1 ? "1 new source" : `${newCount} new sources`;
  }
  const count = cluster.source_ids.length;
  return count === 1 ? "1 source" : `${count} sources`;
}

function mentionCountLabel(count: number): string {
  return count === 1 ? "1 mention" : `${count} mentions`;
}

const panelTextStyle = {
  fontFamily: "var(--mem-font-body)",
  color: "var(--mem-text)",
};

const secondaryTextStyle = {
  fontFamily: "var(--mem-font-body)",
  color: "var(--mem-text-secondary)",
};

const sectionTitleStyle = {
  margin: "0 0 10px",
  fontFamily: "var(--mem-font-heading)",
  fontSize: "15px",
  fontWeight: 500,
  color: "var(--mem-text)",
};

const itemSurfaceStyle = {
  border: "1px solid var(--mem-border)",
  borderRadius: 8,
  backgroundColor: "var(--mem-surface)",
};

function QueueCard({
  item,
  onOpen,
}: {
  item: ReviewItem;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const title =
    item.kind === "revision"
      ? truncateReviewText(item.content, 96)
      : reviewKindLabel(t, item);
  const meta =
    item.kind === "revision"
      ? item.agent
        ? t("review.proposedBy", { agent: item.agent })
        : ""
      : t("review.confidence", { percent: Math.round(item.confidence * 100) });
  return (
    <button
      type="button"
      aria-label={t("review.openItem", { title })}
      onClick={() => onOpen(reviewItemId(item))}
      className="text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
      style={{
        ...itemSurfaceStyle,
        display: "grid",
        gap: 6,
        width: "100%",
        padding: "13px 14px",
        color: "var(--mem-text)",
        cursor: "pointer",
        fontFamily: "var(--mem-font-body)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
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
        {meta && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--mem-text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </span>
        )}
      </span>
      <span
        style={{
          fontFamily: "var(--mem-font-heading)",
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1.35,
        }}
      >
        {title}
      </span>
    </button>
  );
}

export default function DistillReviewPanel({
  onBack,
  onPageClick,
  onMemoryClick,
}: DistillReviewPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<DistillReviewResponse | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const didLoadInitialReview = useRef(false);
  const queue = useReviewQueue();
  const review = useMutation({
    mutationFn: distillReview,
    retry: false,
    onSuccess: (result) => setLastResult(result),
  });
  const error = review.error instanceof Error
    ? review.error.message
    : review.error
      ? String(review.error)
      : null;

  useEffect(() => {
    if (didLoadInitialReview.current) return;
    didLoadInitialReview.current = true;
    review.mutate();
  }, [review]);

  const revisionItems = queue.items.filter((item) => item.kind === "revision");
  const refinementItems = queue.items.filter(
    (item) => item.kind === "refinement",
  );

  const refresh = () => {
    review.mutate();
    queryClient.invalidateQueries({ queryKey: ["pending-revisions"] });
    queryClient.invalidateQueries({ queryKey: ["refinement-proposals"] });
  };

  return (
    <div
      className="flex flex-col"
      style={{
        ...panelTextStyle,
        padding: "28px 36px",
        animation: "mem-fade-up 350ms cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      <div className="flex items-center mb-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="p-1.5 -ml-1.5 rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]"
          style={{
            color: "var(--mem-text-tertiary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            lineHeight: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--mem-font-heading)",
              fontSize: "22px",
              fontWeight: 500,
              color: "var(--mem-text)",
            }}
          >
            {t("review.title")}
          </h1>
          <p style={{ ...secondaryTextStyle, margin: "5px 0 0", fontSize: "13px" }}>
            {t("review.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {queue.items.length > 0 && (
            <span
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
                color: "var(--mem-accent-indigo)",
                backgroundColor: "var(--mem-indigo-bg)",
                borderRadius: 999,
                padding: "4px 11px",
                whiteSpace: "nowrap",
              }}
            >
              {t("review.pendingCount", { count: queue.items.length })}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={review.isPending}
            className="rounded-md px-3 py-2 text-sm transition-colors duration-150 hover:bg-[var(--mem-hover)] disabled:opacity-60"
            style={{
              border: "1px solid var(--mem-border)",
              backgroundColor: "var(--mem-surface)",
              color: "var(--mem-text)",
              cursor: review.isPending ? "default" : "pointer",
              fontFamily: "var(--mem-font-body)",
            }}
          >
            {review.isPending ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            ...itemSurfaceStyle,
            marginTop: 18,
            padding: "10px 12px",
            color: "var(--mem-text)",
            fontFamily: "var(--mem-font-body)",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-6" style={{ marginTop: 24 }}>
        {!queue.isLoading && queue.items.length === 0 && (
          <section>
            <h2 style={sectionTitleStyle}>{t("review.allCaughtUp")}</h2>
            <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
              {t("review.allCaughtUpHint")}
            </p>
          </section>
        )}

        {revisionItems.length > 0 && (
          <section>
            <h2 style={sectionTitleStyle}>{t("review.sectionRevisions")}</h2>
            <div className="grid gap-2.5">
              {revisionItems.map((item) => (
                <QueueCard key={reviewItemId(item)} item={item} onOpen={setOpenId} />
              ))}
            </div>
          </section>
        )}

        {refinementItems.length > 0 && (
          <section>
            <h2 style={sectionTitleStyle}>{t("review.sectionRefinements")}</h2>
            <div className="grid gap-2.5">
              {refinementItems.map((item) => (
                <QueueCard key={reviewItemId(item)} item={item} onOpen={setOpenId} />
              ))}
            </div>
          </section>
        )}

        {lastResult && (
          <>
            <section>
              <h2 style={sectionTitleStyle}>New page candidates</h2>
              {lastResult.pending.length === 0 ? (
                <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                  No new page candidates.
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {lastResult.pending.map((cluster) => {
                    const label = pendingLabel(cluster);
                    const preview = cluster.contents
                      .map((content) => content.trim())
                      .filter((content) => content.length > 0)
                      .slice(0, 2);
                    return (
                      <article
                        key={`${label}-${cluster.source_ids.join("-")}`}
                        style={{
                          ...itemSurfaceStyle,
                          padding: "13px 14px",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontFamily: "var(--mem-font-heading)",
                            fontSize: "15px",
                            fontWeight: 500,
                            color: "var(--mem-text)",
                          }}
                        >
                          {label}
                        </h3>
                        <p style={{ ...secondaryTextStyle, margin: "6px 0 0", fontSize: "12px" }}>
                          {sourceCountLabel(cluster)}
                          {cluster.existing_page_id ? " linked to an existing page" : ""}
                        </p>
                        {preview.map((content, index) => (
                          <p
                            key={index}
                            style={{
                              ...secondaryTextStyle,
                              margin: "7px 0 0",
                              fontSize: "13px",
                              lineHeight: 1.45,
                            }}
                          >
                            {truncateText(content, 140)}
                          </p>
                        ))}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h2 style={sectionTitleStyle}>Pages with new sources</h2>
              {lastResult.stale_truncated && (
                <p style={{ ...secondaryTextStyle, margin: "0 0 10px", fontSize: "12px" }}>
                  Showing the first 10 stale pages returned by the daemon.
                </p>
              )}
              {lastResult.stale_pages.length === 0 ? (
                <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>Pages are current.</p>
              ) : (
                <div className="grid gap-2.5">
                  {lastResult.stale_pages.map((page) => (
                    <button
                      key={page.page_id}
                      type="button"
                      aria-label={`Open ${page.title}`}
                      onClick={() => onPageClick(page.page_id)}
                      className="text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
                      style={{
                        ...itemSurfaceStyle,
                        padding: "13px 14px",
                        color: "var(--mem-text)",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontFamily: "var(--mem-font-heading)",
                          fontSize: "15px",
                          fontWeight: 500,
                        }}
                      >
                        {page.title}
                      </span>
                      {page.summary && (
                        <span
                          style={{
                            ...secondaryTextStyle,
                            display: "block",
                            marginTop: 6,
                            fontSize: "13px",
                            lineHeight: 1.45,
                          }}
                        >
                          {truncateText(page.summary, 140)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 style={sectionTitleStyle}>Unlinked topics</h2>
              {lastResult.orphan_topics.length === 0 ? (
                <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                  No repeated unlinked topics.
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {lastResult.orphan_topics.map((topic) => (
                    <article
                      key={topic.label}
                      style={{
                        ...itemSurfaceStyle,
                        padding: "13px 14px",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontFamily: "var(--mem-font-heading)",
                          fontSize: "15px",
                          fontWeight: 500,
                          color: "var(--mem-text)",
                        }}
                      >
                        {topic.label}
                      </h3>
                      <p style={{ ...secondaryTextStyle, margin: "6px 0 0", fontSize: "12px" }}>
                        {mentionCountLabel(topic.count)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <ReviewDialog
        items={queue.items}
        openId={openId}
        onOpenChange={setOpenId}
        onResolve={queue.resolve}
        isResolving={queue.isResolving}
        onOpenMemory={onMemoryClick}
      />
    </div>
  );
}
