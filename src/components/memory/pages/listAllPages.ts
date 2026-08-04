import { listPages, listPagesExplicitBrowse, type Page } from "../../../lib/tauri";

const PAGE_BATCH_SIZE = 500;

async function listAllPagesWithStatus(
  status: "active" | "draft",
  fetchBatch: typeof listPages,
): Promise<Page[]> {
  const pages: Page[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  while (true) {
    const batch = await fetchBatch(status, undefined, PAGE_BATCH_SIZE, offset);
    let added = 0;
    for (const page of batch) {
      if (seenIds.has(page.id)) continue;
      seenIds.add(page.id);
      pages.push(page);
      added += 1;
    }
    if (batch.length < PAGE_BATCH_SIZE || added === 0) return pages;
    offset += batch.length;
  }
}

export function listAllActivePages(): Promise<Page[]> {
  return listAllPagesWithStatus("active", listPages);
}

export function listAllDraftPages(): Promise<Page[]> {
  return listAllPagesWithStatus("draft", listPages);
}

/** Query options every TanStack query built on an explicit-browse command
 *  must carry. These commands tell the daemon a human asked for this read,
 *  and the daemon's contract counts a machine-driven repeat as automatic —
 *  so every refetch trigger that fires without a human gesture is off here.
 *  Reconnect is the one that actually bites: window focus is already off in
 *  the app's own QueryClient, but a network reconnect would otherwise resend
 *  the marker with nobody at the keyboard. Both are set at the call site
 *  rather than left to a global default, so this stays true in any client.
 *  Refetch on mount (navigating to the Wiki) and invalidation after a user
 *  edit both follow a gesture and are deliberately left alone. */
export const EXPLICIT_BROWSE_QUERY_POLICY = {
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
} as const;

/** Explicit-browse counterparts for visible human page surfaces — see
 *  `listPagesExplicitBrowse` in `lib/tauri.ts` for why their query policy
 *  must never turn them into automatic/polling reads. */
export function listAllActivePagesExplicitBrowse(): Promise<Page[]> {
  return listAllPagesWithStatus("active", listPagesExplicitBrowse);
}

export function listAllDraftPagesExplicitBrowse(): Promise<Page[]> {
  return listAllPagesWithStatus("draft", listPagesExplicitBrowse);
}
