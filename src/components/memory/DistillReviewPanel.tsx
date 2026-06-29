// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  distillReview,
  type DistillPendingCluster,
  type DistillReviewResponse,
} from "../../lib/tauri";

interface DistillReviewPanelProps {
  onBack: () => void;
  onPageClick: (pageId: string) => void;
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

export default function DistillReviewPanel({ onBack, onPageClick }: DistillReviewPanelProps) {
  const [lastResult, setLastResult] = useState<DistillReviewResponse | null>(null);
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
            Distill Review
          </h1>
          <p style={{ ...secondaryTextStyle, margin: "5px 0 0", fontSize: "13px" }}>
            Current daemon review queue
          </p>
        </div>
        <button
          type="button"
          onClick={() => review.mutate()}
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
          {review.isPending ? "Refreshing..." : "Refresh review"}
        </button>
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

      {!lastResult && !review.isPending && (
        <p style={{ ...secondaryTextStyle, margin: "24px 0 0", fontSize: "13px" }}>
          No review loaded.
        </p>
      )}

      {lastResult && (
        <div className="grid gap-6" style={{ marginTop: 24 }}>
          <section>
            <h2 style={sectionTitleStyle}>Pending pages</h2>
            {lastResult.pending.length === 0 ? (
              <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>
                No pending page clusters.
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
            <h2 style={sectionTitleStyle}>Stale pages</h2>
            {lastResult.stale_truncated && (
              <p style={{ ...secondaryTextStyle, margin: "0 0 10px", fontSize: "12px" }}>
                Showing the first 10 stale pages returned by the daemon.
              </p>
            )}
            {lastResult.stale_pages.length === 0 ? (
              <p style={{ ...secondaryTextStyle, margin: 0, fontSize: "13px" }}>No stale pages.</p>
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
        </div>
      )}
    </div>
  );
}
