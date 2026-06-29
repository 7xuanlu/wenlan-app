// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DistillReviewPanel from "./DistillReviewPanel";
import type { DistillReviewResponse } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  distillReview: vi.fn(),
}));

import { distillReview } from "../../lib/tauri";

function renderPanel(props: Partial<React.ComponentProps<typeof DistillReviewPanel>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onBack = props.onBack ?? vi.fn();
  const onPageClick = props.onPageClick ?? vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <DistillReviewPanel onBack={onBack} onPageClick={onPageClick} />
    </QueryClientProvider>,
  );
  return { user, onBack, onPageClick };
}

function truncateForTest(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max <= 3) return ".".repeat(max);
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

const fallbackSource =
  "Fallback content label should appear when no title or entity exists, and this preview detail must stay visible in the review panel source list even when it becomes the cluster title.";
const fallbackSecondSource =
  "A second fallback source confirms the preview keeps the first two contents.";

const reviewPayload: DistillReviewResponse = {
  pages_created: 0,
  scoped: false,
  created_ids: [],
  pending: [
    {
      source_ids: ["mem_1", "mem_2"],
      contents: [
        "This is a detailed source memory about temporal page refresh behavior.",
        "A second source memory adds routing context for the distill review panel.",
      ],
      entity_id: "entity_temporal",
      entity_name: "Temporal refresh",
      space: "Engineering",
      estimated_tokens: 180,
      centroid_embedding: [0.1, 0.2],
      existing_page_id: "page_temporal",
      existing_page_title: "Temporal page refresh",
      new_memory_count: 1,
    },
    {
      source_ids: ["mem_3"],
      contents: [fallbackSource, fallbackSecondSource],
      estimated_tokens: 80,
    },
  ],
  stale_pages: [
    {
      page_id: "page_stale",
      title: "Retrieval Pipeline",
      summary: "Source memories changed after the page compiled.",
      source_memory_ids: ["mem_old"],
      sources_updated_count: 3,
      stale_reason: "source_updated",
      user_edited: false,
    },
  ],
  stale_truncated: true,
  orphan_topics: [{ label: "Vector clocks", count: 4 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DistillReviewPanel", () => {
  it("does not run the distill POST on mount", () => {
    vi.mocked(distillReview).mockResolvedValue(reviewPayload);

    renderPanel();

    expect(distillReview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /refresh review/i })).toBeInTheDocument();
  });

  it("renders review sections after a user-triggered refresh", async () => {
    vi.mocked(distillReview).mockResolvedValue(reviewPayload);
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /refresh review/i }));

    expect(await screen.findByText("Temporal page refresh")).toBeInTheDocument();
    expect(screen.getByText(/1 new source/)).toBeInTheDocument();
    expect(screen.getByText(truncateForTest(fallbackSource, 72))).toBeInTheDocument();
    expect(screen.getByText("Retrieval Pipeline")).toBeInTheDocument();
    expect(screen.getByText(/first 10 stale pages/i)).toBeInTheDocument();
    expect(screen.getByText("Vector clocks")).toBeInTheDocument();
    expect(screen.getByText(/4 mentions/)).toBeInTheDocument();
  });

  it("renders source previews even when a fallback label comes from the first source", async () => {
    vi.mocked(distillReview).mockResolvedValue(reviewPayload);
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /refresh review/i }));

    expect(await screen.findByText(truncateForTest(fallbackSource, 72))).toBeInTheDocument();
    expect(screen.getByText(truncateForTest(fallbackSource, 140))).toBeInTheDocument();
    expect(screen.getByText(fallbackSecondSource)).toBeInTheDocument();
  });

  it("navigates stale pages without exposing rebuild controls", async () => {
    vi.mocked(distillReview).mockResolvedValue(reviewPayload);
    const { user, onPageClick } = renderPanel();

    await user.click(screen.getByRole("button", { name: /refresh review/i }));
    await user.click(await screen.findByRole("button", { name: /open Retrieval Pipeline/i }));

    expect(onPageClick).toHaveBeenCalledWith("page_stale");
    expect(screen.queryByText(/force rebuild/i)).toBeNull();
    expect(screen.queryByText(/synthesize page/i)).toBeNull();
    expect(screen.queryByText(/^rebuild$/i)).toBeNull();
  });

  it("keeps the last successful result visible after refresh failure", async () => {
    vi.mocked(distillReview)
      .mockResolvedValueOnce(reviewPayload)
      .mockRejectedValueOnce(new Error("HTTP POST /api/distill returned 500"));
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /refresh review/i }));
    expect(await screen.findByText("Temporal page refresh")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh review/i }));

    expect(await screen.findByText(/HTTP POST \/api\/distill returned 500/)).toBeInTheDocument();
    expect(screen.getByText("Temporal page refresh")).toBeInTheDocument();
  });
});
