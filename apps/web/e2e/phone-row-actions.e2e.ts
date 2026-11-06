import { devices, type Page } from "@playwright/test";
import { endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
test.use({ ...phone, serviceWorkers: "block" });

const reached = (page: Page, points: readonly { readonly x: number; readonly y: number }[]) =>
  page.evaluate(
    (at) =>
      at.map(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? "MISS"),
    points,
  );

test("an agent row's Pin and More are on the phone, and each takes a tap just inside 10 px of its drawn box", async ({
  page,
}) => {
  const address = startAgent("host", "tapme", "idle");
  // A detail far longer than the row: the text that used to run under the actions.
  const long = startAgent("host", "longrow", "idle", "a-long-space-name-for-the-detail");
  try {
    await page.goto("/");
    const row = page.getByRole("button", { name: /tapme/ }).first();
    const pin = page.getByRole("button", { name: "Pin tapme" });
    const more = page.getByRole("button", { name: "More for tapme" });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(pin).toBeVisible();

    const boxes = await Promise.all([pin.boundingBox(), more.boundingBox()]);
    const [left, right] = boxes;
    if (left === null || right === null) throw new Error("no box");
    for (const box of boxes) {
      expect(box?.width, "the drawn button stays 24 px").toBe(24);
      expect(box?.height, "the drawn button stays 24 px").toBe(24);
    }
    expect(right.x - (left.x + left.width), "the two hit areas neither overlap nor meet").toBeGreaterThanOrEqual(24);

    // Just inside the 10 px edge, so sub-pixel rounding of the hit area cannot decide the result.
    const OUT = 9.5;
    const labels = [await pin.getAttribute("aria-label"), await more.getAttribute("aria-label")];
    const points = [left, right].flatMap((box, index) => {
      const midX = box.x + box.width / 2;
      const midY = box.y + box.height / 2;
      const label = labels[index] ?? null;
      return [
        { side: "left", x: box.x - OUT, y: midY, label },
        { side: "right", x: box.x + box.width + OUT, y: midY, label },
        { side: "top", x: midX, y: box.y - OUT, label },
        { side: "bottom", x: midX, y: box.y + box.height + OUT, label },
        { side: "top-left", x: box.x - OUT, y: box.y - OUT, label },
        { side: "top-right", x: box.x + box.width + OUT, y: box.y - OUT, label },
        { side: "bottom-left", x: box.x - OUT, y: box.y + box.height + OUT, label },
        { side: "bottom-right", x: box.x + box.width + OUT, y: box.y + box.height + OUT, label },
      ];
    });
    const hits = await reached(page, points);
    points.forEach(({ side, label }, index) =>
      expect.soft(hits[index], `a tap 10 px ${side} of "${label}" reaches it`).toBe(label),
    );

    // The row made room for the actions instead of covering what it draws: a long detail stops before them, and the
    // row's meta stays, because nothing had to give way.
    const longRow = page.getByRole("button", { name: /longrow/ }).first();
    const longPin = page.getByRole("button", { name: "Pin longrow" });
    await expect(longPin).toBeVisible();
    const detail = await longRow.locator('[data-floor="detail"]').boundingBox();
    const longPinBox = await longPin.boundingBox();
    if (detail === null || longPinBox === null) throw new Error("no box");
    expect(detail.x + detail.width, "the row's text stops before its actions").toBeLessThanOrEqual(longPinBox.x);
    await expect(longRow.locator("[data-row-meta]").first()).toHaveCSS("visibility", "visible");

    // A space row's meta is its own signal: its status dot and tab count stay in its name, and its "..." waits for a hover.
    await expect(page.getByRole("button", { name: /\d+ tabs/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "More for api" })).toHaveCount(0);

    await pin.tap();
    await expect(page.getByRole("button", { name: "Unpin tapme" })).toBeVisible();
  } finally {
    endAgent("host", address);
    endAgent("host", long);
  }
});
