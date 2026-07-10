// SPDX-License-Identifier: AGPL-3.0-only
// Fixture data for the browser preview harness. Mirrors the shapes in
// PageDetail.citations.test.tsx so the preview shows the same states the
// tests assert.
import type {
  Page,
  PageCitation,
  PageLinksResponse,
  PageSourceWithMemory,
  ListPageRevisionsResponse,
  PendingRevisionItem,
  RecentActivityItem,
  RefinementProposalSummary,
  MemoryItem,
  EntityDetail,
  DistillReviewResponse,
} from "../src/lib/tauri";

const cite = (
  occurrence: number,
  marker: number,
  over: Partial<PageCitation> = {},
): PageCitation => ({
  occurrence,
  marker,
  source_kind: "memory",
  locator: `mem-${marker}`,
  score: 0.9,
  status: "verified",
  scope: "sentence",
  ...over,
});

const CITED_CONTENT = `# Wenlan Daemon Architecture

The wenlan daemon runs entirely on the local machine, with no cloud dependency for core recall.[1] Storage is backed by libSQL with vector search extensions.[2]

## Storage layer

Distilled pages and raw memories share a single database file.[3] The schema versioning strategy follows the upstream design notes.[4]

## Distillation

Pages are compiled from source memories by the pipeline described in [[Memory Distillation]].[5] Authored sections survive re-distillation untouched.[6]

See also [[LibSQL Storage]].
`;

const base = {
  summary: null,
  entity_id: null,
  domain: "architecture",
  source_memory_ids: ["mem-1", "mem-2"],
  version: 3,
  status: "active",
  created_at: "2026-06-20T09:00:00+00:00",
  last_compiled: "2026-07-02T18:30:00+00:00",
  last_modified: "2026-07-02T18:30:00+00:00",
};

export const PAGES: Record<string, Page> = {
  "page-cited": {
    ...base,
    id: "page-cited",
    title: "Wenlan Daemon Architecture",
    content: CITED_CONTENT,
    citations: [
      cite(1, 1),
      cite(2, 2, { status: "unverified" }),
      cite(3, 3, { locator: "mem-9" }),
      cite(4, 4, {
        source_kind: "external_url",
        locator: "https://docs.turso.tech/libsql",
      }),
      cite(5, 5, {
        source_kind: "external_file",
        locator: "/Users/lucian/notes/distillation-design.md",
      }),
      cite(6, 6, { source_kind: "authored", locator: "authored" }),
    ],
  } as Page,
  "page-cleared": {
    ...base,
    id: "page-cleared",
    title: "Edit-Cleared Citations",
    content: CITED_CONTENT,
    citations: [],
  } as Page,
  "page-mismatch": {
    ...base,
    id: "page-mismatch",
    title: "Mismatched Citations",
    content:
      "# Mismatched Citations\n\nOnly two markers here.[1] But three citations arrive from the wire.[2]",
    citations: [cite(1, 1), cite(2, 2), cite(3, 3)],
  } as Page,
  "page-plain": {
    ...base,
    id: "page-plain",
    title: "Memory Distillation",
    content:
      "# Memory Distillation\n\nA page with no citation markers at all — the pre-citations rendering path.",
    citations: undefined,
  } as Page,
};

// Pristine copies so the mock redistill_page can restore after update_page
// clears citations (mirrors the backend edit-path contract).
export const PRISTINE: Record<string, Page> = JSON.parse(JSON.stringify(PAGES));

const memory = (
  id: string,
  title: string,
  content: string,
  lastModified: number,
) => ({
  source: { page_id: "page-cited", memory_source_id: id, linked_at: 1_750_000_000 },
  memory: {
    source_id: id,
    title,
    content,
    summary: null,
    memory_type: "memory",
    domain: null,
    source_agent: "claude-code",
    confidence: 0.92,
    confirmed: true,
    pinned: false,
    supersedes: null,
    last_modified: lastModified,
    chunk_count: 1,
  },
});

export const SOURCES: PageSourceWithMemory[] = [
  memory(
    "mem-1",
    "Local-first decision",
    "We keep the daemon local-first: recall never leaves the machine.",
    1_751_300_000,
  ),
  memory(
    "mem-2",
    "libSQL storage choice",
    "Chose libSQL over sqlite-vss for the built-in vector extension.",
    1_748_000_000,
  ),
  // mem-9 is deliberately absent: exercises the unresolvable-source fallback
  // in CitationChip and the count-vs-rows case in PageInfo.
];

export const LINKS: PageLinksResponse = {
  outbound: [
    { label: "Memory Distillation", target_page_id: "page-plain" },
    { label: "LibSQL Storage", target_page_id: null },
  ],
  inbound: [{ source_page_id: "page-plain", label: "Wenlan Daemon Architecture" }],
};

// --- review queue fixtures (DistillReviewPanel + ReviewDialog preview) ---

const reviewMemory = (
  id: string,
  title: string,
  content: string,
  lastModified: number,
): MemoryItem => ({
  source_id: id,
  title,
  content,
  summary: null,
  memory_type: "memory",
  domain: null,
  source_agent: "claude-code",
  confidence: 0.9,
  confirmed: true,
  pinned: false,
  supersedes: null,
  last_modified: lastModified,
  chunk_count: 1,
});

export const REVIEW_MEMORIES: Record<string, MemoryItem> = {
  "mem-pkg": reviewMemory(
    "mem-pkg",
    "JS package manager preference",
    "Lucian prefers npm for JavaScript package management across projects.",
    1_751_300_000,
  ),
  "mem-daemon-port": reviewMemory(
    "mem-daemon-port",
    "Daemon port convention",
    "The wenlan daemon listens on port 7878 and the dev server runs on 1420. Restarting the daemon requires killing the old process first before the port frees up.",
    1_751_100_000,
  ),
  "mem-review-flow": reviewMemory(
    "mem-review-flow",
    "Review workflow",
    "Review happens through the plugin /curate command, one item at a time in the terminal.",
    1_750_900_000,
  ),
  "mem-editor-a": reviewMemory(
    "mem-editor-a",
    "Editor choice",
    "Uses Visual Studio Code as the main editor.",
    1_750_800_000,
  ),
  "mem-editor-b": reviewMemory(
    "mem-editor-b",
    "Editor note",
    "Recently switched to Zed for Rust work.",
    1_751_200_000,
  ),
};

const reviewRevisions = (): PendingRevisionItem[] => [
  {
    target_source_id: "mem-pkg",
    revision_source_id: "mem-pkg-rev",
    revision_content:
      "Lucian prefers pnpm for JavaScript package management across projects, keeping npm only for one-off npx invocations.",
    source_agent: "claude-code",
    last_modified: 1_752_000_000,
  },
  {
    target_source_id: "mem-daemon-port",
    revision_source_id: "mem-daemon-port-rev",
    revision_content:
      "The wenlan daemon listens on port 7878 and the dev server runs on 1420. The preview harness uses 1421.",
    source_agent: "codex",
    last_modified: 1_752_000_100,
  },
  {
    target_source_id: "mem-review-flow",
    revision_source_id: "mem-review-flow-rev",
    revision_content:
      "Review happens in the desktop app: a queue page with a before/after diff dialog, approve or dismiss per item.",
    source_agent: "claude-code",
    last_modified: 1_752_000_200,
  },
];

const reviewProposals = (): RefinementProposalSummary[] => [
  {
    id: "prop-merge-vscode",
    action: "entity_merge",
    source_ids: ["ent-vscode", "ent-vs-code"],
    payload: {
      action: "entity_merge",
      existing_id: "ent-vscode",
      new_id: "ent-vs-code",
      similarity: 0.93,
    } as RefinementProposalSummary["payload"],
    confidence: 0.93,
    created_at: "2026-07-08T14:20:00Z",
  },
  {
    id: "prop-contra-editor",
    action: "detect_contradiction",
    source_ids: ["mem-editor-a", "mem-editor-b"],
    payload: { action: "detect_contradiction" } as RefinementProposalSummary["payload"],
    confidence: 0.78,
    created_at: "2026-07-09T09:05:00Z",
  },
];

const reviewCaptures = (): RecentActivityItem[] => [
  {
    kind: "memory",
    id: "mem-capture-shortcuts",
    title: "Prefers keyboard-first review: Enter approves, D dismisses",
    snippet: "Observed while walking the review queue during the redesign session.",
    timestamp_ms: 1_752_000_300_000,
    badge: { kind: "needs_review" },
  },
  {
    kind: "memory",
    id: "mem-capture-worktree",
    title: "Feature work happens in git worktrees, never directly on main",
    snippet: "Stated as a standing rule for all wenlan-app development.",
    timestamp_ms: 1_752_000_400_000,
    badge: { kind: "needs_review" },
  },
];

export const REVIEW_STATE: {
  revisions: PendingRevisionItem[];
  proposals: RefinementProposalSummary[];
  captures: RecentActivityItem[];
} = {
  revisions: reviewRevisions(),
  proposals: reviewProposals(),
  captures: reviewCaptures(),
};

export function resetReviewFixtures(): void {
  REVIEW_STATE.revisions = reviewRevisions();
  REVIEW_STATE.proposals = reviewProposals();
  REVIEW_STATE.captures = reviewCaptures();
}

export const REVIEW_ENTITIES: Record<string, EntityDetail> = {
  "ent-vscode": {
    entity: {
      id: "ent-vscode",
      name: "Visual Studio Code",
      entity_type: "tool",
      domain: "tools",
      source_agent: "claude-code",
      confidence: 0.95,
      confirmed: true,
      created_at: 1_749_000_000,
      updated_at: 1_751_500_000,
    },
    observations: [
      {
        id: "obs-1",
        entity_id: "ent-vscode",
        content: "Primary editor for TypeScript work.",
        source_agent: "claude-code",
        confidence: 0.9,
        confirmed: true,
        created_at: 1_749_100_000,
      },
    ],
    relations: [],
  },
  "ent-vs-code": {
    entity: {
      id: "ent-vs-code",
      name: "VS Code",
      entity_type: "tool",
      domain: "tools",
      source_agent: "codex",
      confidence: 0.8,
      confirmed: false,
      created_at: 1_751_900_000,
      updated_at: 1_751_900_000,
    },
    observations: [
      {
        id: "obs-2",
        entity_id: "ent-vs-code",
        content: "Mentioned as the editor used for the wenlan-app repo.",
        source_agent: "codex",
        confidence: 0.8,
        confirmed: false,
        created_at: 1_751_900_000,
      },
    ],
    relations: [],
  },
};

export const REVIEW_DISTILL: DistillReviewResponse = {
  pages_created: 0,
  scoped: false,
  created_ids: [],
  pending: [
    {
      source_ids: ["mem-pkg", "mem-daemon-port"],
      contents: [
        "Lucian prefers npm for JavaScript package management across projects.",
        "The wenlan daemon listens on port 7878 and the dev server runs on 1420.",
      ],
      entity_id: "ent-tooling",
      entity_name: "Project tooling",
      space: "Engineering",
      estimated_tokens: 160,
      existing_page_id: "page-cited",
      existing_page_title: "Wenlan Daemon Architecture",
      new_memory_count: 2,
    },
  ],
  stale_pages: [
    {
      page_id: "page-cited",
      title: "Wenlan Daemon Architecture",
      summary: "Source memories changed after the page compiled.",
      source_memory_ids: ["mem-1", "mem-2"],
      sources_updated_count: 2,
      stale_reason: "source_updated",
      user_edited: false,
    },
  ],
  stale_truncated: false,
  orphan_topics: [{ label: "Preview harness", count: 3 }],
};

export const REVISIONS: ListPageRevisionsResponse = {
  page_id: "page-cited",
  current_version: 3,
  user_edited: false,
  stale_reason: null,
  entries: [
    {
      version: 3,
      at: 1_751_480_000,
      edited_by: "distiller",
      delta_summary: "Re-distilled after 2 new source memories",
      incoming_source_ids: ["mem-2"],
      citations_summary: "Citations: 6 (1 unverified)",
    },
    {
      version: 2,
      at: 1_750_400_000,
      edited_by: "user",
      delta_summary: "Manual edit of the storage section",
      incoming_source_ids: null,
      citations_summary: null,
    },
    {
      version: 1,
      at: 1_750_000_000,
      edited_by: "distiller",
      delta_summary: "Initial distillation from 2 memories",
      incoming_source_ids: ["mem-1", "mem-2"],
      citations_summary: "Citations: 4",
    },
  ],
};
