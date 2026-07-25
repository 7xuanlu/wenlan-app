// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from "@playwright/test";
import { installTauriMock } from "./tauriMock";

/**
 * Where the canvas's pointer and keyboard input actually lands.
 *
 * The map is a graphical surface inside a document that is not, and the seam
 * between them is where input goes wrong: a drag that misses the pane starts a
 * text selection, and a keystroke that misses the surface reaches the browser
 * instead of the map.
 */
async function openCanvas(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Wiki", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Fixture architecture" }).click();
  await page.getByRole("button", { name: "Canvas" }).click();
  await expect(page.getByRole("region", { name: "Canvas for Fixture architecture" })).toBeVisible();
}

async function marquees(page: Page): Promise<number> {
  return page.locator(".react-flow__selection").count();
}

test("a rubber-band drag leaves nothing behind", async ({ page }) => {
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await openCanvas(page);
  const pane = page.locator(".react-flow__pane");
  const area = (await pane.boundingBox())!;

  // Four drags anchored near the bottom-right, each reaching further into the
  // top-left — the gesture from the recording.
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(area.x + area.width - 40, area.y + area.height - 30);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width - 40 - i * 90, area.y + area.height - 30 - i * 60, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(120);
    console.log(`after drag ${i}: ${await marquees(page)} marquee(s) in the DOM`);
  }
  await page.locator(".page-canvas").screenshot({ path: "shots/marquee-after.png" });
  expect(await marquees(page)).toBe(0);
});

test("select all picks the boxes, not the page text", async ({ page }) => {
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await openCanvas(page);
  // Deliberately no click into the canvas first: opening it leaves focus on the
  // Canvas button in the page header, which is where a reader's first keystroke
  // actually lands.
  console.log(
    `focus after opening: ${await page.evaluate(
      () => `${document.activeElement?.tagName}.${document.activeElement?.className}`,
    )}`,
  );
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(200);
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  const selectedNodes = await page.locator(".react-flow__node.selected").count();
  console.log(
    `meta+a → ${selectedNodes} node(s) selected, ${selectedText.length} chars of page text highlighted`,
  );
  await page.locator(".page-canvas").screenshot({ path: "shots/select-all.png" });
  expect(selectedText, "meta+a highlighted page text instead of selecting boxes").toBe("");
  expect(selectedNodes).toBeGreaterThan(1);
});

test("a new box stays where it was dropped", async ({ page }) => {
  // A slow map read, or the refetch lands before the box can be measured where
  // it was dropped and the jump is invisible to the test.
  const controller = await installTauriMock(page, {
    locale: "en",
    rawActions: [],
    delays: { get_page_map: 1200 },
  });
  await openCanvas(page);
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  const spot = { x: pane.x + pane.width - 110, y: pane.y + pane.height - 130 };

  await page.mouse.dblclick(spot.x, spot.y);
  const field = page.getByRole("textbox", { name: "Section name" });
  await expect(field).toBeVisible();
  await field.fill("Deploy notes");
  await field.press("Enter");

  const made = page.locator(".react-flow__node").filter({ hasText: "Deploy notes" }).first();
  await expect(made).toBeVisible();
  const center = async () => {
    const r = (await made.boundingBox())!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const dropped = await center();
  // Guard the guard: if this is already the settled position, the test is
  // measuring after the jump and would pass with the bug in.
  expect(
    Math.hypot(dropped.x - spot.x, dropped.y - spot.y),
    "the held box is not where the double-click was",
  ).toBeLessThan(130);

  // Wait out the whole create: heading write, node create, position write, and
  // the map refetch that replaces the held box with the server's copy. That
  // refetch is the moment the box used to jump, because a node the daemon
  // reports as unplaced is given a computed slot on the ring.
  await expect
    .poll(() => controller.calls().filter((c) => c.command === "get_page_map").length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(1);
  await page.waitForTimeout(1500);

  const settled = await center();
  const moved = Math.hypot(settled.x - dropped.x, settled.y - dropped.y);
  console.log(
    `dropped at (${Math.round(dropped.x)},${Math.round(dropped.y)}), settled at (${Math.round(settled.x)},${Math.round(settled.y)}) — moved ${Math.round(moved)}px`,
  );
  // The box grows to fit its label, so its edges shift a little; its center is
  // what the drop placed and what must hold.
  expect(moved, "the new box jumped after it was created").toBeLessThan(24);
});

test("select all from outside the canvas cannot paint over the map", async ({ page }) => {
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await openCanvas(page);
  // Focus back out to the page around the canvas, the way clicking a header
  // control leaves it, then select all. The browser's own select-all is allowed
  // to highlight the document — it must not reach inside the map, where it
  // paints an opaque block over everything.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Meta+a");
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  await page.locator(".page-canvas").screenshot({ path: "shots/select-all-unfocused.png" });
  for (const inside of ["Add section", "Improve", "suggestion", "Storage layer"]) {
    expect(selected, `select-all reached "${inside}" inside the canvas`).not.toContain(inside);
  }
});

test("the grow dot sits on the side each box faces", async ({ page }) => {
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await page.goto("/");
  // A map big enough to put boxes in all four quadrants: the fixture's four
  // boxes sit on one axis, which would leave the up and down cases unchecked.
  await page.evaluate(async () => {
    const add = async (parent: string, label: string): Promise<string> => {
      const result = (await window.__wenlanTauriInvoke("create_page_map_node", {
        pageId: "page-architecture",
        body: { parent_id: parent, label, ref_kind: "section", ref_id: label },
      })) as { node: { id: string } };
      return result.node.id;
    };
    const ingest = await add("n_root", "Ingest pipeline");
    await add(ingest, "Chunking");
    await add(ingest, "Embedding queue");
    const api = await add("n_root", "HTTP surface");
    await add(api, "Auth");
    await add("n_root", "Observability");
    await add("n_query", "Reranking");
  });
  await openCanvas(page);
  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+a");
  await page.locator(".page-canvas").screenshot({ path: "shots/grow-dots.png" });

  // Every box's dot, against the direction that box sits from the page in the
  // middle. On a radial map those directions differ, so a dot pinned to one
  // side is pointing back at the parent for half of them.
  const dots = await page.locator(".react-flow__node").evaluateAll((els) => {
    const root = els.find((el) => el.textContent?.includes("Fixture architecture"));
    const c = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const origin = c(root!);
    return els
      .filter((el) => el !== root)
      .map((el) => {
        const handle = el.querySelector(".page-canvas-grow")!;
        const side = ["top", "right", "bottom", "left"].find((s) =>
          handle.classList.contains(`react-flow__handle-${s}`),
        );
        const p = c(el);
        return {
          label: (el.textContent ?? "").slice(0, 24),
          side,
          dx: Math.round(p.x - origin.x),
          dy: Math.round(p.y - origin.y),
        };
      });
  });
  console.log(JSON.stringify(dots, null, 1));
  expect(dots.length).toBeGreaterThan(1);
  for (const d of dots) {
    const want =
      Math.abs(d.dx) > Math.abs(d.dy)
        ? d.dx > 0
          ? "right"
          : "left"
        : d.dy > 0
          ? "bottom"
          : "top";
    expect(d.side, `${d.label} sits at (${d.dx},${d.dy}) but its dot is on the ${d.side}`).toBe(
      want,
    );
  }
});

test("a drag that starts on a canvas control selects no text", async ({ page }) => {
  await installTauriMock(page, { locale: "en", rawActions: [] });
  await openCanvas(page);
  const surface = page.locator(".page-canvas-surface");
  const area = (await surface.boundingBox())!;

  for (const [name, from] of [
    ["help button (bottom right)", page.getByRole("button", { name: "Canvas shortcuts" })],
    ["suggestion badge (top right)", page.getByRole("button", { name: /suggestion/ })],
  ] as const) {
    const start = (await from.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + 60, area.y + 40, { steps: 12 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    console.log(`${name}: selected ${JSON.stringify(selected.slice(0, 70))}`);
    await page
      .locator(".page-canvas")
      .screenshot({ path: `shots/drag-from-${name.split(" ")[0]}.png` });
    expect(selected, `dragging from the ${name} selected page text`).toBe("");
  }
});
