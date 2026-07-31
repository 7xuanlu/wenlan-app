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

/** Explicit-browse counterparts, for the human "browse the wiki" surface
 *  (`PagesOverview.tsx`) only — see `listPagesExplicitBrowse` in
 *  `lib/tauri.ts` for why this must never back an automatic/polling read. */
export function listAllActivePagesExplicitBrowse(): Promise<Page[]> {
  return listAllPagesWithStatus("active", listPagesExplicitBrowse);
}

export function listAllDraftPagesExplicitBrowse(): Promise<Page[]> {
  return listAllPagesWithStatus("draft", listPagesExplicitBrowse);
}
