import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

type Platform = "mac" | "other";
type Move = "right" | "down" | "left" | "up";

/** Ghostty's and herdr-app's keys: ⌘D ⌘⇧D and ⌘⌥arrows on macOS; Ctrl+Shift+O / E and Ctrl+Alt+arrows elsewhere. */
const KEYS: Readonly<Record<Platform, { split: Record<"right" | "down", string>; go: Record<Move, string> }>> = {
  mac: {
    split: { right: "Meta+d", down: "Meta+Shift+d" },
    go: {
      left: "Meta+Alt+ArrowLeft",
      right: "Meta+Alt+ArrowRight",
      up: "Meta+Alt+ArrowUp",
      down: "Meta+Alt+ArrowDown",
    },
  },
  other: {
    split: { right: "Control+Shift+O", down: "Control+Shift+E" },
    go: {
      left: "Control+Alt+ArrowLeft",
      right: "Control+Alt+ArrowRight",
      up: "Control+Alt+ArrowUp",
      down: "Control+Alt+ArrowDown",
    },
  },
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const focusedAddress = (page: Page): Promise<string | null> =>
  page.locator('[data-focused="true"] [data-terminal]').getAttribute("data-terminal", { timeout: 15_000 });

const keyboardAddress = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null);

/** Whether the strip's selected tab controls the tab panel that shows the terminal. */
const selectedTabHolds = (page: Page, address: string): Promise<boolean> =>
  page.evaluate((target) => {
    const tab = document.querySelector('[role="tablist"][aria-label="Tabs"] [role="tab"][aria-selected="true"]');
    const panel = document.getElementById(tab?.getAttribute("aria-controls") ?? "");
    return panel?.getAttribute("role") === "tabpanel" && panel.querySelector(`[data-terminal="${target}"]`) !== null;
  }, address);

const paneOf = (page: Page, address: string): Locator =>
  page.locator("section", { has: page.locator(`[data-terminal="${address}"]`) });

async function boxOf(page: Page, address: string): Promise<Box> {
  const box = await paneOf(page, address).boundingBox();
  if (box === null) throw new Error(`${address} has no box`);
  return box;
}

async function boxes(page: Page, addresses: readonly string[]): Promise<Record<string, Box>> {
  return Object.fromEntries(await Promise.all(addresses.map(async (address) => [address, await boxOf(page, address)])));
}

const across = (a: number, aLength: number, b: number, bLength: number): boolean => a < b + bLength && b < a + aLength;

/** Right of (or below) `from`: past its far edge, and overlapping it across the other axis. */
function lies(box: Box, from: Box, side: Move): boolean {
  switch (side) {
    case "right":
      return box.x >= from.x + from.width - 1 && across(box.y, box.height, from.y, from.height);
    case "left":
      return box.x + box.width <= from.x + 1 && across(box.y, box.height, from.y, from.height);
    case "down":
      return box.y >= from.y + from.height - 1 && across(box.x, box.width, from.x, from.width);
    case "up":
      return box.y + box.height <= from.y + 1 && across(box.x, box.width, from.x, from.width);
  }
}

/** Presses a split key and returns the new pane once it holds the focus, the keys and the selected tab. */
async function split(page: Page, platform: Platform, side: "right" | "down", from: string): Promise<string> {
  const tabs = await page.getByRole("tablist", { name: "Tabs" }).getByRole("tab").count();
  await page.keyboard.press(KEYS[platform].split[side]);
  await expect.poll(() => focusedAddress(page), { timeout: 15_000 }).not.toBe(from);
  const created = await focusedAddress(page);
  if (created === null) throw new Error("no pane is focused after the split");
  await expect(paneOf(page, created)).toContainText("$", { timeout: 15_000 });
  await expect.poll(() => keyboardAddress(page), { timeout: 5_000 }).toBe(created);
  await expect.poll(() => selectedTabHolds(page, created), { timeout: 5_000 }).toBe(true);
  await expect(page.getByRole("tablist", { name: "Tabs" }).getByRole("tab")).toHaveCount(tabs);
  expect(lies(await boxOf(page, created), await boxOf(page, from), side)).toBe(true);
  return created;
}

for (const platform of ["mac", "other"] as const) {
  test(`${platform}: four nested splits, right and down, each focus the new pane; moving focus moves no pane`, async ({
    page,
  }) => {
    if (platform === "mac") {
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
    }
    await page.goto("/");
    const first = await openNewTerminal(page);
    const one = (await first.getAttribute("data-terminal")) ?? "";
    await first.getByRole("textbox").focus();

    const two = await split(page, platform, "right", one);
    const three = await split(page, platform, "down", two);
    const four = await split(page, platform, "right", three);
    const five = await split(page, platform, "down", four);
    await page.keyboard.type("echo deepest-$((2+3))");
    await page.keyboard.press("Enter");
    await expect(paneOf(page, five)).toContainText("deepest-5", { timeout: 15_000 });
    await expect(paneOf(page, one)).not.toContainText("deepest-5");

    const all = [one, two, three, four, five];
    const placed = await boxes(page, all);
    const steps: readonly [Move, string][] = [
      ["up", four],
      ["left", three],
      ["up", two],
      ["left", one],
      ["right", two],
    ];
    await steps.reduce<Promise<void>>(async (previous, [move, lands]) => {
      await previous;
      await page.keyboard.press(KEYS[platform].go[move]);
      await expect.poll(() => focusedAddress(page), { timeout: 5_000 }).toBe(lands);
      await expect.poll(() => keyboardAddress(page), { timeout: 5_000 }).toBe(lands);
      await expect.poll(() => selectedTabHolds(page, lands), { timeout: 5_000 }).toBe(true);
    }, Promise.resolve());
    expect(await boxes(page, all)).toEqual(placed);
  });
}
