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
  useReviewItemSummary,
} from "./ReviewDialog";
import { relativeMs } from "./page/format";
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

/** Mockup section-label: small uppercase eyebrow with a mono count beside it. */
const sectionTitleStyle = {
  margin: "0 0 10px",
  fontFamily: "var(--mem-font-body)",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "var(--mem-text-tertiary)",
  display: "flex",
  alignItems: "baseline",
  gap: 8,
};

const sectionCountStyle = {
  fontFamily: "var(--mem-font-mono)",
  fontVariantNumeric: "tabular-nums" as const,
  fontWeight: 400,
};

const emptyTitleStyle = {
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
  // Mockup card anatomy: chip + age on top, a real title (page/entity names,
  // never the bare kind label), then the evidence line (word delta, overlap,
  // similarity) — the reason a decision is being asked for.
  const { title, reason, delta } = useReviewItemSummary(item);
  const age = item.timestampMs != null ? relativeMs(item.timestampMs) : null;
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
      className="text-left transition-[background-color,border-color,transform] duration-150 hover:bg-[var(--mem-hover)] hover:border-[var(--mem-accent-indigo)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[var(--mem-accent-indigo)] focus-visible:outline-offset-2"
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
        {age && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--mem-text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            {age}
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
      {(delta != null || reason) && (
        <span
          style={{
            ...secondaryTextStyle,
            display: "flex",
            gap: 10,
            alignItems: "baseline",
            flexWrap: "wrap",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {delta != null && (
            <span
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: 11.5,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: "var(--mem-accent-sage)" }}>
                +{delta.added}
              </span>{" "}
              <span style={{ color: "var(--mem-status-danger-text)" }}>
                −{delta.removed}
              </span>
            </span>
          )}
          {reason}
        </span>
      )}
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
  // Stale pages refreshed this session — a new distill result resets the set.
  const [resolvedStaleIds, setResolvedStaleIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const didLoadInitialReview = useRef(false);
  const queue = useReviewQueue();
  const review = useMutation({
    mutationFn: distillReview,
    retry: false,
    onSuccess: (result) => {
      setLastResult(result);
      setResolvedStaleIds(new Set());
    },
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
  // Compiled pages whose sources changed — actionable: approve re-distills.
  const stalePageItems = (lastResult?.stale_pages ?? [])
    .filter((page) => !resolvedStaleIds.has(page.page_id))
    .map(
      (page): ReviewItem => ({
        kind: "stale_page",
        id: page.page_id,
        title: page.title,
        summary: page.summary ?? null,
        sourcesUpdated: page.sources_updated_count ?? null,
        timestampMs: null,
      }),
    );
  // Dialog order mirrors the page: decisions, page refreshes, then discovery.
  const dialogItems = [
    ...decisionItems,
    ...stalePageItems,
    ...candidateItems,
    ...topicItems,
  ];

  // Stale-page refreshes resolve against the panel's distill result, not the
  // queue caches — drop them here after the daemon verb succeeds.
  const resolveItem = async (args: { item: ReviewItem; approve: boolean }) => {
    const result = await queue.resolve(args);
    if (args.item.kind === "stale_page" && args.approve) {
      const pageId = args.item.id;
      setResolvedStaleIds((prev) => new Set(prev).add(pageId));
    }
    return result;
  };

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
    (candidateItems.length > 0 ||
      stalePageItems.length > 0 ||
      topicItems.length > 0);
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
            <h2 style={emptyTitleStyle}>{t("review.allCaughtUp")}</h2>
            <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
              {t("review.allCaughtUpHint")}
            </p>
          </section>
        )}

        {sections.map(
          (section) =>
            section.items.length > 0 && (
              <section key={section.key}>
                <h2 style={sectionTitleStyle}>
                  {section.title}
                  <span aria-hidden="true" style={sectionCountStyle}>
                    {section.items.length}
                  </span>
                </h2>
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

        {lastResult && (
          <section>
            <h2 style={sectionTitleStyle}>
              {t("review.sectionStalePages")}
              {stalePageItems.length > 0 && (
                <span aria-hidden="true" style={sectionCountStyle}>
                  {stalePageItems.length}
                </span>
              )}
            </h2>
            {lastResult.stale_truncated && (
              <p style={{ ...secondaryTextStyle, margin: "0 0 10px", fontSize: "12px" }}>
                {t("review.staleTruncated")}
              </p>
            )}
            {stalePageItems.length === 0 ? (
              <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                {t("review.pagesCurrent")}
              </p>
            ) : (
              <div className="grid gap-2.5">
                {stalePageItems.map((item) => (
                  <QueueCard
                    key={reviewItemId(item)}
                    item={item}
                    onOpen={setOpenId}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {candidateItems.length > 0 && (
          <section>
            <h2 style={sectionTitleStyle}>
              {t("review.sectionPageCandidates")}
              <span aria-hidden="true" style={sectionCountStyle}>
                {candidateItems.length}
              </span>
            </h2>
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

        {lastResult && topicItems.length > 0 && (
          <section>
            <h2 style={sectionTitleStyle}>
              {t("review.sectionOrphanTopics")}
              <span aria-hidden="true" style={sectionCountStyle}>
                {topicItems.length}
              </span>
            </h2>
            <div className="grid gap-2.5">
              {topicItems.map((item) => (
                <QueueCard
                  key={reviewItemId(item)}
                  item={item}
                  onOpen={setOpenId}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <ReviewDialog
        items={dialogItems}
        openId={openId}
        onOpenChange={setOpenId}
        onResolve={resolveItem}
        isResolving={queue.isResolving}
        onOpenMemory={onMemoryClick}
        onOpenPage={onPageClick}
      />
    </div>
  );
}
