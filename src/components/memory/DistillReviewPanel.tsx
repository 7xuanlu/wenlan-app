// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  distillReview,
  type DistillPendingCluster,
  type DistillReviewResponse,
} from "../../lib/tauri";
import ReviewDialog, {
  reviewKindLabel,
  reviewKindTone,
  truncateReviewText,
} from "./ReviewDialog";
import {
  reviewItemId,
  reviewItemSection,
  useReviewQueue,
  type ReviewItem,
} from "./useReviewQueue";

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

function pendingLabel(cluster: DistillPendingCluster): string | null {
  const fromContent = firstNonEmpty(cluster.contents);
  // Content fallback: strip a leading markdown heading marker and collapse
  // newlines so raw memory text reads as a title.
  const contentTitle = fromContent
    ? truncateText(fromContent.replace(/^#+\s*/, "").replace(/\s+/g, " "), 72)
    : null;
  return firstNonEmpty([
    cluster.existing_page_title,
    cluster.entity_name,
    cluster.space,
    contentTitle,
  ]);
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
      : item.kind === "capture"
        ? truncateReviewText(item.title, 96)
        : item.kind === "page_candidate"
          ? item.title
          : item.kind === "topic"
            ? item.label
            : reviewKindLabel(t, item);
  const meta =
    item.kind === "revision"
      ? item.agent
        ? t("review.proposedBy", { agent: item.agent })
        : ""
      : item.kind === "capture"
        ? item.snippet
          ? truncateReviewText(item.snippet, 96)
          : ""
        : item.kind === "page_candidate"
          ? (item.cluster.new_memory_count != null
              ? t("review.newSources", {
                  count: item.cluster.new_memory_count,
                })
              : t("review.sources", {
                  count: item.cluster.source_ids.length,
                })) +
            (item.cluster.existing_page_id
              ? ` · ${t("review.linkedExistingPage")}`
              : "")
          : item.kind === "topic"
            ? t("review.mentions", { count: item.count })
            : t("review.confidence", {
                percent: Math.round(item.confidence * 100),
              });
  const tone = reviewKindTone(item);
  const preview =
    item.kind === "page_candidate"
      ? item.cluster.contents
          .map((content) => content.trim())
          .filter((content) => content.length > 0)
          .slice(0, 2)
      : [];
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
            color: tone.color,
            backgroundColor: tone.background,
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
      {preview.map((content, index) => (
        <span
          key={index}
          style={{
            ...secondaryTextStyle,
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {truncateText(content, 140)}
        </span>
      ))}
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

  // Deferred past StrictMode's setup→cleanup→setup cycle: mutating inside the
  // first effect setup detaches the mutation observer on cleanup, leaving the
  // hook stuck reporting pending after the mutation has already succeeded.
  useEffect(() => {
    const id = setTimeout(() => {
      if (didLoadInitialReview.current) return;
      didLoadInitialReview.current = true;
      review.mutate();
    }, 0);
    return () => clearTimeout(id);
  }, [review.mutate]);

  // New-memory captures are inflow, not decisions — they surface as a count
  // on the home context rail instead of flooding this queue.
  const decisionItems = queue.items.filter((item) => item.kind !== "capture");

  // Distill discovery rendered through the same card + dialog pattern as the
  // actionable queue, read-only until the daemon grows verbs for them.
  const candidateItems = (lastResult?.pending ?? []).map(
    (cluster, clusterIndex): ReviewItem => ({
      kind: "page_candidate",
      id: cluster.source_ids.join("-") || `cluster-${clusterIndex}`,
      title: pendingLabel(cluster) ?? t("review.untitledCluster"),
      cluster,
      timestampMs: null,
    }),
  );
  const topicItems = (lastResult?.orphan_topics ?? []).map(
    (topic): ReviewItem => ({
      kind: "topic",
      id: topic.label,
      label: topic.label,
      count: topic.count,
      timestampMs: null,
    }),
  );
  // Dialog order mirrors the page: decisions first, then discovery.
  const dialogItems = [...decisionItems, ...candidateItems, ...topicItems];

  // Section order mirrors the queue's revisions > conflicts > pages ranking.
  const sections = [
    { key: "revisions", title: t("review.sectionRevisions") },
    { key: "conflicts", title: t("review.sectionConflicts") },
    { key: "pages", title: t("review.sectionPages") },
    { key: "memory", title: t("review.sectionRefinements") },
  ].map((section) => ({
    ...section,
    items: decisionItems.filter(
      (item) => reviewItemSection(item) === section.key,
    ),
  }));

  // "All caught up" must count the distill discovery too — an empty decision
  // queue with pending page work is not caught up.
  const distillHasWork =
    lastResult != null &&
    (lastResult.pending.length > 0 ||
      lastResult.stale_pages.length > 0 ||
      lastResult.orphan_topics.length > 0);
  const allCaughtUp =
    !queue.isLoading &&
    !review.isPending &&
    decisionItems.length === 0 &&
    !distillHasWork;

  const refresh = () => {
    review.mutate();
    queryClient.invalidateQueries({ queryKey: ["pending-revisions"] });
    queryClient.invalidateQueries({ queryKey: ["refinement-proposals"] });
    queryClient.invalidateQueries({ queryKey: ["unconfirmed-captures"] });
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
          {decisionItems.length > 0 && (
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
              {t("review.pendingCount", {
                count: queue.decisionsTruncated
                  ? `${decisionItems.length}+`
                  : decisionItems.length,
              })}
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
            {review.isPending ? t("review.refreshing") : t("review.refresh")}
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
        {allCaughtUp && (
          <section>
            <h2 style={sectionTitleStyle}>{t("review.allCaughtUp")}</h2>
            <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
              {t("review.allCaughtUpHint")}
            </p>
          </section>
        )}

        {sections.map(
          (section) =>
            section.items.length > 0 && (
              <section key={section.key}>
                <h2 style={sectionTitleStyle}>{section.title}</h2>
                <div className="grid gap-2.5">
                  {section.items.map((item) => (
                    <QueueCard
                      key={reviewItemId(item)}
                      item={item}
                      onOpen={setOpenId}
                    />
                  ))}
                </div>
              </section>
            ),
        )}

        {candidateItems.length > 0 && (
          <section>
            <h2 style={sectionTitleStyle}>{t("review.sectionPageCandidates")}</h2>
            <div className="grid gap-2.5">
              {candidateItems.map((item) => (
                <QueueCard
                  key={reviewItemId(item)}
                  item={item}
                  onOpen={setOpenId}
                />
              ))}
            </div>
          </section>
        )}

        {lastResult && (
          <>
            <section>
              <h2 style={sectionTitleStyle}>{t("review.sectionStalePages")}</h2>
              {lastResult.stale_truncated && (
                <p style={{ ...secondaryTextStyle, margin: "0 0 10px", fontSize: "12px" }}>
                  {t("review.staleTruncated")}
                </p>
              )}
              {lastResult.stale_pages.length === 0 ? (
                <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                  {t("review.pagesCurrent")}
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {lastResult.stale_pages.map((page) => (
                    <button
                      key={page.page_id}
                      type="button"
                      aria-label={t("home.openPage", { title: page.title })}
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
              <h2 style={sectionTitleStyle}>{t("review.sectionOrphanTopics")}</h2>
              {topicItems.length === 0 ? (
                <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                  {t("review.noOrphanTopics")}
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {topicItems.map((item) => (
                    <QueueCard
                      key={reviewItemId(item)}
                      item={item}
                      onOpen={setOpenId}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <ReviewDialog
        items={dialogItems}
        openId={openId}
        onOpenChange={setOpenId}
        onResolve={queue.resolve}
        isResolving={queue.isResolving}
        onOpenMemory={onMemoryClick}
        onOpenPage={onPageClick}
      />
    </div>
  );
}
