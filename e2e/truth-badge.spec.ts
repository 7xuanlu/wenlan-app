// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import type { Page as KnowledgePage } from "../src/lib/tauri";
import { createSpacesNavigationFixture } from "./fixtures/spacesNavigation";
import { collectBrowserErrors, installTauriMock } from "./tauriMock";

const evidenceDirectory = ".omo/evidence/truth-badge";

function truthPages(): KnowledgePage[] {
  const defaults = createSpacesNavigationFixture().pages;
  return [
    {
      ...defaults[0]!,
      id: "truth-supported-unreviewed",
      title: "Truth badge supported and unreviewed",
      truth: { supported: true, human_reviewed: false },
    },
    {
      ...defaults[1]!,
      id: "truth-supported-reviewed",
      title: "Truth badge supported and reviewed",
      truth: { supported: true, human_reviewed: true },
    },
    {
      ...defaults[2]!,
      id: "truth-provisional-unreviewed",
      title: "Truth badge provisional and unreviewed",
      truth: { supported: false, human_reviewed: false },
    },
    {
      ...defaults[3]!,
      id: "truth-provisional-reviewed",
      title: "Truth badge provisional and reviewed",
      truth: { supported: false, human_reviewed: true },
    },
  ];
}

async function openWiki(page: Parameters<typeof installTauriMock>[0]) {
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Wiki", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Wiki" })).toBeVisible();
  await expect(page.locator("tr.wiki-page-row")).toHaveCount(4);
}

async function automaticSearch(page: Parameters<typeof installTauriMock>[0]) {
  return page.evaluate(async () => {
    const response = await window.__wenlanTauriInvoke("search", {
      query: "truth badge",
      limit: 10,
      sourceFilter: null,
    });
    return response as Array<{ title: string }>;
  });
}

test("pre-cutover stays inert while explicit page browsing remains intact", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const pages = truthPages();
  const controller = await installTauriMock(page, {
    locale: "en",
    rawActions: [],
    fixture: { pages },
    pageScenario: {
      truthStatus: null,
      automaticPageSearchPages: pages,
    },
  });
  await page.goto("/");
  await openWiki(page);

  await expect(page.locator('[data-testid="pages-library"] [data-testid^="page-truth-"]')).toHaveCount(0);
  for (const truthPage of pages) {
    await expect(page.getByRole("button", { name: `Open ${truthPage.title}`, exact: true })).toBeVisible();
  }

  const automaticResults = await automaticSearch(page);
  expect(automaticResults.map((result) => result.title)).toEqual(pages.map((truthPage) => truthPage.title));
  expect(controller.calls().map((call) => call.command)).toContain("search");
  expect(controller.calls().map((call) => call.command)).toContain("list_pages_explicit_browse");

  await page.screenshot({ path: `${evidenceDirectory}/pre-cutover.png`, fullPage: true });
  expect(browserErrors.pageErrors).toEqual([]);
  expect(browserErrors.consoleErrors).toEqual([]);
});

test("cutover-live shows both independent truth axes while automatic search stays unmarked", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const pages = truthPages();
  const controller = await installTauriMock(page, {
    locale: "en",
    rawActions: [],
    fixture: { pages },
    pageScenario: {
      truthStatus: { cutover_generation: 1, contract_version: 1 },
      automaticPageSearchPages: pages,
    },
  });
  await page.goto("/");
  await openWiki(page);

  const table = page.locator('[data-testid="pages-library"]');
  await expect(table.locator('[data-testid="page-truth-support"]')).toHaveCount(4);
  await expect(table.locator('[data-testid="page-truth-review"]')).toHaveCount(4);

  const expectedLabels = [
    ["Truth badge supported and unreviewed", "Source support: Supported", "Human review: Unreviewed"],
    ["Truth badge supported and reviewed", "Source support: Supported", "Human review: Reviewed"],
    ["Truth badge provisional and unreviewed", "Source support: Provisional", "Human review: Unreviewed"],
    ["Truth badge provisional and reviewed", "Source support: Provisional", "Human review: Reviewed"],
  ] as const;
  for (const [title, supportLabel, reviewLabel] of expectedLabels) {
    const row = table.locator("tr.wiki-page-row").filter({ hasText: title });
    await expect(row.getByTestId("page-truth-support")).toHaveAttribute("aria-label", supportLabel);
    await expect(row.getByTestId("page-truth-review")).toHaveAttribute("aria-label", reviewLabel);
  }

  await automaticSearch(page);
  const searchCall = controller.calls().find((call) => call.command === "search");
  expect(searchCall?.args).toEqual({ query: "truth badge", limit: 10, sourceFilter: null });
  expect(controller.calls().map((call) => call.command)).toContain("list_pages_explicit_browse");

  await page.screenshot({ path: `${evidenceDirectory}/cutover-live.png`, fullPage: true });
  expect(browserErrors.pageErrors).toEqual([]);
  expect(browserErrors.consoleErrors).toEqual([]);
});
