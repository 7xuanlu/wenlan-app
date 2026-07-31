// SPDX-License-Identifier: AGPL-3.0-only
import {
  listCommunities,
  listCommunityMembers,
  asCommunityApiError,
  COMMUNITY_READ_SCHEMA_VERSION,
} from "../tauri";
import type { CommunityMember, CommunityMemberCursor, CommunitySummary } from "../tauri";

// D13/App-PR readiness contract: a space's durable community assignment is
// authoritative only once BOTH cursor-paginated reads (communities, then
// members) drain to exhaustion AND every member row's published_generation
// agrees with the space's current generation (read off the community
// summaries). Anything short of that keeps the numeric fallback — see
// cartography.ts — but the two outcomes are NOT the same visible state:
// "fallback" is the ordinary, silent case (no durable data published for
// this space yet); "partial-error" means something is actually wrong (an
// old daemon, a dropped connection, a schema change, or a generation that
// moved mid-read) and must stay visible, never silently folded into
// "fallback".

export type CartographyStatus = "ready" | "fallback" | "partial-error";

export type PartialErrorReason =
  | "transport"
  | "old-daemon"
  | "schema-mismatch"
  | "generation-mismatch"
  | "interrupted"
  | "member-count-mismatch"
  | "foreign-space";

export interface SpaceCartography {
  status: CartographyStatus;
  /** Present only when status === "ready": every member node id the daemon
   *  assigned under the space's currently published generation. */
  memberCommunityId?: Map<string, string>;
  /** Present only when status === "partial-error". */
  reason?: PartialErrorReason;
}

// Guards against a daemon that never sets next_cursor to null (a bug, or a
// pathologically huge space) turning a UI fetch into an infinite loop. 500
// pages at the default page size of 100 is 50,000 rows — already far past
// anything a desktop-scale corpus should produce.
const MAX_PAGES = 500;

function isOldDaemonStatus(status: number): boolean {
  return status === 404 || status === 405;
}

type PageResult<T> = { rows: T[] } | { reason: PartialErrorReason };

async function fetchAllCommunities(space: string): Promise<PageResult<CommunitySummary>> {
  const rows: CommunitySummary[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await listCommunities(space, cursor);
    } catch (e) {
      const apiError = asCommunityApiError(e);
      return { reason: apiError && isOldDaemonStatus(apiError.status) ? "old-daemon" : "transport" };
    }
    if (response.schema_version !== COMMUNITY_READ_SCHEMA_VERSION) {
      return { reason: "schema-mismatch" };
    }
    // The daemon's `scope` isn't threaded through the Tauri command today
    // (see app/src/api.rs's CommunityListResponse) — checking each row's own
    // `space` field is what actually catches a daemon serving the wrong
    // scope instead of silently mixing it into this space's read.
    if (response.communities.some((c) => c.space !== space)) {
      return { reason: "foreign-space" };
    }
    rows.push(...response.communities);
    if (response.next_cursor === null) return { rows };
    cursor = response.next_cursor;
  }
  return { reason: "interrupted" };
}

async function fetchAllMembers(space: string): Promise<PageResult<CommunityMember>> {
  const rows: CommunityMember[] = [];
  let cursor: CommunityMemberCursor | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await listCommunityMembers(space, cursor);
    } catch (e) {
      const apiError = asCommunityApiError(e);
      return { reason: apiError && isOldDaemonStatus(apiError.status) ? "old-daemon" : "transport" };
    }
    if (response.schema_version !== COMMUNITY_READ_SCHEMA_VERSION) {
      return { reason: "schema-mismatch" };
    }
    if (response.members.some((m) => m.space !== space)) {
      return { reason: "foreign-space" };
    }
    rows.push(...response.members);
    if (response.next_cursor === null) return { rows };
    cursor = response.next_cursor;
  }
  return { reason: "interrupted" };
}

/**
 * Fetch and classify one space's durable cartography. Pagination always
 * runs to exhaustion (or the MAX_PAGES safety cap) before a verdict is
 * reached — a space is never declared ready off a partial read.
 */
export async function fetchSpaceCartography(space: string): Promise<SpaceCartography> {
  const communities = await fetchAllCommunities(space);
  if ("reason" in communities) return { status: "partial-error", reason: communities.reason };

  const members = await fetchAllMembers(space);
  if ("reason" in members) return { status: "partial-error", reason: members.reason };

  if (communities.rows.length === 0 && members.rows.length === 0) {
    // No durable community data published for this space yet — the
    // ordinary, expected pre-cutover state. Not an error.
    return { status: "fallback" };
  }

  // The generation(s) this space's own community summaries were published
  // under must agree — a daemon reporting two generations for one space is
  // itself a consistency fault, not routine staleness. (Also catches the
  // members-without-summaries case: an empty summaries set never has
  // exactly one generation, so it falls through to generation-mismatch
  // below rather than being silently treated as ready.)
  const generations = new Set(communities.rows.map((c) => c.published_generation));
  if (generations.size !== 1) {
    return { status: "partial-error", reason: "generation-mismatch" };
  }
  const [currentGeneration] = generations;

  const memberCommunityId = new Map<string, string>();
  const actualCounts = new Map<string, number>();
  for (const member of members.rows) {
    // Covers both a mid-pagination generation bump on the member stream and
    // a member page landing on a generation the summary read never saw.
    if (member.published_generation !== currentGeneration) {
      return { status: "partial-error", reason: "generation-mismatch" };
    }
    memberCommunityId.set(member.node_id, member.community_id);
    actualCounts.set(member.community_id, (actualCounts.get(member.community_id) ?? 0) + 1);
  }

  // Generation agreement alone doesn't prove the member read is COMPLETE for
  // each community — a daemon that drops rows mid-drain (or reports a stale
  // next_cursor: null) still agrees on generation while quietly delivering
  // fewer members than the summary promised. Reconcile every community's
  // drained count against its own member_count before trusting the read.
  for (const community of communities.rows) {
    if ((actualCounts.get(community.community_id) ?? 0) !== community.member_count) {
      return { status: "partial-error", reason: "member-count-mismatch" };
    }
  }

  return { status: "ready", memberCommunityId };
}

/** Fan out `fetchSpaceCartography` across every known space. One space's
 *  failure never blocks another's — each entry classifies independently. */
export async function fetchCartographyForSpaces(
  spaces: string[],
): Promise<Map<string, SpaceCartography>> {
  const entries = await Promise.all(
    spaces.map(async (space): Promise<[string, SpaceCartography]> => [
      space,
      await fetchSpaceCartography(space),
    ]),
  );
  return new Map(entries);
}

/** Worst-first aggregate for the toolbar badge: one bad space taints the
 *  whole view rather than being averaged away. `hasUnscopedFallback` reports
 *  whether the model has any null-space node (a relation-only synthesized
 *  neighbor — see model.ts / cartography.ts's UNSCOPED_SPACE) — that bucket
 *  never has a known space to be keyed under in `bySpace`, so it can't
 *  otherwise be seen here, and it's always rendered on the fallback climb.
 *  Its presence means the aggregate can never claim all-durable. Null only
 *  when there are no known spaces AND no unscoped presence to report on. */
export function aggregateCartographyStatus(
  bySpace: Map<string, SpaceCartography>,
  hasUnscopedFallback = false,
): CartographyStatus | null {
  if (bySpace.size === 0 && !hasUnscopedFallback) return null;
  let worst: CartographyStatus = "ready";
  for (const { status } of bySpace.values()) {
    if (status === "partial-error") return "partial-error";
    if (status === "fallback") worst = "fallback";
  }
  if (hasUnscopedFallback && worst === "ready") worst = "fallback";
  return worst;
}
