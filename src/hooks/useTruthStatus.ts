// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { getTruthStatus, type TruthStatus } from "../lib/tauri";

export const TRUTH_STATUS_QUERY_KEY = ["truth-status"] as const;

/**
 * The only affirmative UI gate for M5 truth semantics. An omitted response,
 * an unreachable daemon, and generation zero all mean that the app must keep
 * the compatibility surface inert.
 */
export function useTruthStatus(): {
  status: TruthStatus | null | undefined;
  cutoverLive: boolean;
} {
  // A few legacy component fixtures provide a deliberately narrow Tauri mock;
  // an absent status command must be treated exactly like an old daemon.
  const readTruthStatus = typeof getTruthStatus === "function"
    ? getTruthStatus
    : async () => null;
  const { data: status } = useQuery({
    queryKey: TRUTH_STATUS_QUERY_KEY,
    queryFn: readTruthStatus,
    staleTime: 30_000,
    retry: false,
  });

  return {
    status,
    cutoverLive: status?.cutover_generation != null && status.cutover_generation > 0,
  };
}
