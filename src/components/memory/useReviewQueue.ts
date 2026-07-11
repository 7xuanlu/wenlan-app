// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptPendingRevision,
  acceptRefinement,
  confirmMemory,
  deleteMemory,
  dismissPendingRevision,
  listPendingRevisions,
  listRefinements,
  listUnconfirmedMemories,
  rejectRefinement,
  type PendingRevisionItem,
  type ProposalAction,
  type RecentActivityItem,
  type RefinementPayload,
  type RefinementProposalSummary,
} from "../../lib/tauri";

export type ReviewItem =
  | {
      kind: "revision";
      id: string;
      targetSourceId: string;
      revisionSourceId: string;
      content: string;
      agent: string | null;
      timestampMs: number | null;
    }
  | {
      kind: "refinement";
      id: string;
      action: ProposalAction;
      sourceIds: string[];
      payload: RefinementPayload | null;
      confidence: number;
      timestampMs: number | null;
    }
  | {
      kind: "capture";
      id: string;
      title: string;
      snippet: string | null;
      timestampMs: number | null;
    };

export function reviewItemId(item: ReviewItem): string {
  return item.kind + ":" + item.id;
}

export type ReviewSection =
  | "pages"
  | "conflicts"
  | "revisions"
  | "memory"
  | "captures";

/** Queue order: page-level work first, then conflicts, then memory-level. */
const SECTION_ORDER: ReviewSection[] = [
  "pages",
  "conflicts",
  "revisions",
  "memory",
  "captures",
];

export function reviewItemSection(item: ReviewItem): ReviewSection {
  if (item.kind === "revision") return "revisions";
  if (item.kind === "capture") return "captures";
  switch (item.action) {
    case "page_merge":
    case "page_keep_or_archive":
      return "pages";
    case "detect_contradiction":
    case "relation_conflict":
      return "conflicts";
    default:
      return "memory";
  }
}

function compareReviewItems(a: ReviewItem, b: ReviewItem): number {
  const rankDelta =
    SECTION_ORDER.indexOf(reviewItemSection(a)) -
    SECTION_ORDER.indexOf(reviewItemSection(b));
  if (rankDelta !== 0) return rankDelta;
  return (b.timestampMs ?? -Infinity) - (a.timestampMs ?? -Infinity);
}

const REVISIONS_KEY = ["pending-revisions"];
const REFINEMENTS_KEY = ["refinement-proposals"];
const CAPTURES_KEY = ["unconfirmed-captures"];

/** Per-source fetch cap. A source returning a full page means the true count
 * is unknown — surface counts as "N+" via `isTruncated`, never as exact. */
export const REVIEW_QUEUE_LIMIT = 50;

/**
 * Unified actionable review queue: pending memory revisions plus daemon
 * refinement proposals. `resolve` approves or dismisses one item through the
 * matching daemon verb and removes it from the cached queue immediately.
 */
export function useReviewQueue(enabled: boolean = true) {
  const queryClient = useQueryClient();

  const revisions = useQuery({
    queryKey: REVISIONS_KEY,
    queryFn: () => listPendingRevisions(REVIEW_QUEUE_LIMIT),
    refetchInterval: 30_000,
    enabled,
  });
  const refinements = useQuery({
    queryKey: REFINEMENTS_KEY,
    queryFn: () => listRefinements(REVIEW_QUEUE_LIMIT),
    refetchInterval: 30_000,
    enabled,
  });
  const captures = useQuery({
    queryKey: CAPTURES_KEY,
    queryFn: () => listUnconfirmedMemories(REVIEW_QUEUE_LIMIT),
    refetchInterval: 30_000,
    enabled,
  });

  const items: ReviewItem[] = useMemo(
    () => [
      ...(revisions.data ?? []).map(
        (item: PendingRevisionItem): ReviewItem => ({
          kind: "revision",
          id: item.target_source_id,
          targetSourceId: item.target_source_id,
          revisionSourceId: item.revision_source_id,
          content: item.revision_content,
          agent: item.source_agent,
          timestampMs: item.last_modified ? item.last_modified * 1000 : null,
        }),
      ),
      ...(refinements.data?.proposals ?? []).map(
        (proposal: RefinementProposalSummary): ReviewItem => ({
          kind: "refinement",
          id: proposal.id,
          action: proposal.action,
          sourceIds: proposal.source_ids,
          payload: proposal.payload ?? null,
          confidence: proposal.confidence,
          // The daemon emits "YYYY-MM-DD HH:MM:SS"; Date.parse needs the "T".
          timestampMs: proposal.created_at
            ? (Number.isNaN(Date.parse(proposal.created_at.replace(" ", "T")))
                ? null
                : Date.parse(proposal.created_at.replace(" ", "T")))
            : null,
        }),
      ),
      ...(captures.data ?? []).map(
        (entry: RecentActivityItem): ReviewItem => ({
          kind: "capture",
          id: entry.id,
          title: entry.title,
          snippet: entry.snippet,
          timestampMs: entry.timestamp_ms ?? null,
        }),
      ),
    ].sort(compareReviewItems),
    [revisions.data, refinements.data, captures.data],
  );

  const resolveMutation = useMutation({
    mutationFn: async ({
      item,
      approve,
    }: {
      item: ReviewItem;
      approve: boolean;
    }) => {
      if (item.kind === "revision") {
        return approve
          ? acceptPendingRevision(item.targetSourceId)
          : dismissPendingRevision(item.targetSourceId);
      }
      if (item.kind === "capture") {
        // Curate semantics: confirm keeps the memory, "dismiss" forgets it.
        return approve ? confirmMemory(item.id) : deleteMemory(item.id);
      }
      return approve ? acceptRefinement(item.id) : rejectRefinement(item.id);
    },
    onSuccess: (_result, { item }) => {
      // Drop the resolved item from the cache right away so the queue and any
      // open dialog advance without waiting for the refetch.
      if (item.kind === "revision") {
        queryClient.setQueryData<PendingRevisionItem[]>(
          REVISIONS_KEY,
          (old) =>
            old?.filter(
              (entry) => entry.target_source_id !== item.targetSourceId,
            ) ?? [],
        );
      } else if (item.kind === "capture") {
        queryClient.setQueryData<RecentActivityItem[]>(
          CAPTURES_KEY,
          (old) => old?.filter((entry) => entry.id !== item.id) ?? [],
        );
      } else {
        queryClient.setQueryData<{ proposals: RefinementProposalSummary[] }>(
          REFINEMENTS_KEY,
          (old) => ({
            proposals:
              old?.proposals.filter((entry) => entry.id !== item.id) ?? [],
          }),
        );
      }
      queryClient.invalidateQueries({ queryKey: REVISIONS_KEY });
      queryClient.invalidateQueries({ queryKey: REFINEMENTS_KEY });
      queryClient.invalidateQueries({ queryKey: CAPTURES_KEY });
    },
  });

  const decisionsTruncated =
    (revisions.data?.length ?? 0) >= REVIEW_QUEUE_LIMIT ||
    (refinements.data?.proposals.length ?? 0) >= REVIEW_QUEUE_LIMIT;
  const capturesTruncated = (captures.data?.length ?? 0) >= REVIEW_QUEUE_LIMIT;

  return {
    items,
    isLoading: revisions.isLoading || refinements.isLoading || captures.isLoading,
    error: revisions.error ?? refinements.error ?? captures.error ?? null,
    /** True when any source filled its page — the queue may hold more. */
    isTruncated: decisionsTruncated || capturesTruncated,
    /** Decision sources (revisions + refinements) at their fetch cap. */
    decisionsTruncated,
    /** New-memory captures at their fetch cap. */
    capturesTruncated,
    resolve: resolveMutation.mutateAsync,
    isResolving: resolveMutation.isPending,
  };
}
