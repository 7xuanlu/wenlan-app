// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptPendingRevision,
  acceptRefinement,
  dismissPendingRevision,
  listPendingRevisions,
  listRefinements,
  rejectRefinement,
  type PendingRevisionItem,
  type ProposalAction,
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
    }
  | {
      kind: "refinement";
      id: string;
      action: ProposalAction;
      sourceIds: string[];
      payload: RefinementPayload | null;
      confidence: number;
    };

export function reviewItemId(item: ReviewItem): string {
  return item.kind + ":" + item.id;
}

const REVISIONS_KEY = ["pending-revisions"];
const REFINEMENTS_KEY = ["refinement-proposals"];

/**
 * Unified actionable review queue: pending memory revisions plus daemon
 * refinement proposals. `resolve` approves or dismisses one item through the
 * matching daemon verb and removes it from the cached queue immediately.
 */
export function useReviewQueue(enabled: boolean = true) {
  const queryClient = useQueryClient();

  const revisions = useQuery({
    queryKey: REVISIONS_KEY,
    queryFn: () => listPendingRevisions(50),
    refetchInterval: 30_000,
    enabled,
  });
  const refinements = useQuery({
    queryKey: REFINEMENTS_KEY,
    queryFn: () => listRefinements(50),
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
        }),
      ),
    ],
    [revisions.data, refinements.data],
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
    },
  });

  return {
    items,
    isLoading: revisions.isLoading || refinements.isLoading,
    error: revisions.error ?? refinements.error ?? null,
    resolve: resolveMutation.mutateAsync,
    isResolving: resolveMutation.isPending,
  };
}
