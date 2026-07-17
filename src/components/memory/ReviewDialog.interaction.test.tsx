// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n";
import { getPage } from "../../lib/tauri";
import ReviewDialog from "./ReviewDialog";
import { reviewItemId, type ReviewItem } from "./useReviewQueue";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  getPage: vi.fn(),
}));

const validCleanupItem: ReviewItem = {
  kind: "refinement",
  id: "cleanup-valid",
  action: "page_keep_or_archive",
  sourceIds: ["memory-evidence"],
  payload: {
    action: "page_keep_or_archive",
    page_id: "page-thin",
    source_count: 1,
  },
  confidence: 1,
  timestampMs: 0,
};

function ReviewHarness({
  item,
  onResolve,
}: {
  readonly item: ReviewItem;
  readonly onResolve: (args: { item: ReviewItem; approve: boolean }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => setOpen(true)}>Open review</button>
      <ReviewDialog
        items={[item]}
        openId={open ? reviewItemId(item) : null}
        onOpenChange={(next) => setOpen(next !== null)}
        onResolve={onResolve}
        isResolving={false}
      />
    </QueryClientProvider>
  );
}

describe("ReviewDialog interaction safety", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.mocked(getPage).mockReset();
    vi.mocked(getPage).mockResolvedValue({
      id: "page-thin",
      title: "Thin scratch page",
      summary: "One source.",
      content: "",
    } as never);
  });

  it("lets a focused Keep page button own Enter without also archiving", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ReviewHarness item={validCleanupItem} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Open review" }));

    const dialog = await screen.findByRole("dialog");
    const keep = within(dialog).getByRole("button", { name: "Keep page" });
    keep.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve).toHaveBeenCalledWith({ item: validCleanupItem, approve: false });
  });

  it("fails closed when a cleanup proposal has no valid Page id", async () => {
    const malformed: ReviewItem = {
      ...validCleanupItem,
      id: "cleanup-malformed",
      payload: null,
    };
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ReviewHarness item={malformed} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Open review" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("traps focus inside the modal and restores the opener on close", async () => {
    const user = userEvent.setup();
    render(<ReviewHarness item={validCleanupItem} onResolve={vi.fn().mockResolvedValue(undefined)} />);
    const opener = screen.getByRole("button", { name: "Open review" });
    await user.click(opener);

    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const archive = within(dialog).getByRole("button", { name: "Archive" });

    archive.focus();
    await user.tab();
    expect(close).toHaveFocus();

    close.focus();
    await user.tab({ shift: true });
    expect(archive).toHaveFocus();

    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
