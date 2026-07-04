// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MemoryItem,
  PageChangelogEntry,
  PageCitation,
  PageSourceWithMemory,
} from "../../../lib/tauri";
import PageInfo from "./PageInfo";

const memory = (id: string, over: Partial<MemoryItem> = {}): MemoryItem => ({
  source_id: id,
  title: `Title ${id}`,
  content: `Content of ${id}.`,
  summary: null,
  memory_type: "memory",
  domain: null,
  source_agent: "claude-code",
  confidence: null,
  confirmed: true,
  pinned: false,
  supersedes: null,
  last_modified: 1_700_000_000,
  chunk_count: 1,
  ...over,
});

const source = (id: string, over: Partial<MemoryItem> = {}): PageSourceWithMemory => ({
  source: { page_id: "page-1", memory_source_id: id, linked_at: 0 },
  memory: memory(id, over),
});

const cite = (
  occurrence: number,
  marker: number,
  locator: string,
  over: Partial<PageCitation> = {},
): PageCitation => ({
  occurrence,
  marker,
  source_kind: "memory",
  locator,
  score: 0.9,
  status: "verified",
  scope: "sentence",
  ...over,
});

const revision = (over: Partial<PageChangelogEntry> = {}): PageChangelogEntry => ({
  version: 2,
  at: Math.floor(Date.now() / 1000),
  edited_by: "distill",
  delta_summary: "Added backlinks",
  incoming_source_ids: ["mem-1"],
  ...over,
});

function renderInfo(over: Partial<React.ComponentProps<typeof PageInfo>> = {}) {
  const onMemoryClick = vi.fn();
  const onPageClick = vi.fn();
  const utils = render(
    <PageInfo
      sourceCount={0}
      sources={[]}
      inbound={[]}
      revisions={[]}
      citations={undefined}
      citationState="none"
      onMemoryClick={onMemoryClick}
      onPageClick={onPageClick}
      {...over}
    />,
  );
  return { onMemoryClick, onPageClick, user: userEvent.setup(), ...utils };
}

describe("PageInfo", () => {
  it("always renders, with zero counts in the summary line", () => {
    renderInfo();
    expect(
      screen.getByText("0 sources · 0 backlinks · 0 revisions"),
    ).toBeInTheDocument();
  });

  it("is collapsed by default and expands on summary click", async () => {
    const { user } = renderInfo({
      sourceCount: 1,
      sources: [source("mem-1")],
    });
    expect(screen.getByText("Title mem-1")).not.toBeVisible();
    await user.click(screen.getByText(/Page info/i));
    expect(screen.getByText("Title mem-1")).toBeVisible();
  });

  it("orders sources by first citation occurrence, then uncited by recency", async () => {
    const { user } = renderInfo({
      sourceCount: 3,
      sources: [
        source("mem-a", { last_modified: 300 }),
        source("mem-b", { last_modified: 100 }),
        source("mem-c", { last_modified: 200 }),
      ],
      citations: [cite(1, 1, "mem-b"), cite(2, 2, "mem-a")],
      citationState: "cited",
    });
    await user.click(screen.getByText(/Page info/i));
    const rows = screen.getAllByTestId("page-info-source-row");
    expect(within(rows[0]).getByText("Title mem-b")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Title mem-a")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Title mem-c")).toBeInTheDocument();
  });

  it("tags sources that carry unverified citations and opens memories on click", async () => {
    const { user, onMemoryClick } = renderInfo({
      sourceCount: 1,
      sources: [source("mem-a")],
      citations: [cite(1, 1, "mem-a", { status: "unverified" })],
      citationState: "cited",
    });
    await user.click(screen.getByText(/Page info/i));
    const row = screen.getByTestId("page-info-source-row");
    expect(within(row).getByText("unverified")).toBeInTheDocument();
    await user.click(row);
    expect(onMemoryClick).toHaveBeenCalledWith("mem-a");
  });

  it("shows backlinks by label without raw page ids", async () => {
    const { user, onPageClick } = renderInfo({
      inbound: [{ source_page_id: "page-uuid-42", label: "Inbound Mention" }],
    });
    await user.click(screen.getByText(/Page info/i));
    await user.click(screen.getByRole("button", { name: "Inbound Mention" }));
    expect(onPageClick).toHaveBeenCalledWith("page-uuid-42");
    expect(screen.queryByText(/page-uuid-42/)).toBeNull();
  });

  it("renders revisions with a citations_summary chip", async () => {
    const { user } = renderInfo({
      revisions: [revision({ citations_summary: "3 verified, 1 unverified" })],
    });
    await user.click(screen.getByText(/Page info/i));
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Added backlinks")).toBeInTheDocument();
    expect(screen.getByText("3 verified, 1 unverified")).toBeInTheDocument();
  });

  it("shows the citation count diagnosability line", async () => {
    const { user } = renderInfo({
      citations: [cite(1, 1, "mem-a"), cite(2, 2, "mem-b", { status: "unverified" })],
      citationState: "cited",
    });
    await user.click(screen.getByText(/Page info/i));
    expect(screen.getByText("Citations: 2 (1 unverified)")).toBeInTheDocument();
  });

  it("explains stripped states", async () => {
    const { user } = renderInfo({ citationState: "stripped-empty" });
    await user.click(screen.getByText(/Page info/i));
    expect(
      screen.getByText("Citations cleared by edit — re-distill to restore"),
    ).toBeInTheDocument();
  });

  it("explains mismatch fallback", async () => {
    const { user } = renderInfo({ citationState: "stripped-mismatch" });
    await user.click(screen.getByText(/Page info/i));
    expect(
      screen.getByText("Citation data mismatched — re-distill to repair"),
    ).toBeInTheDocument();
  });

  it("omits the diagnosability line when there are no citations and no markers", async () => {
    const { user } = renderInfo({ citationState: "none" });
    await user.click(screen.getByText(/Page info/i));
    expect(screen.queryByText(/Citations/)).toBeNull();
  });
});
