import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal } from "./fixtures.ts";

export const strip = (page: Page) => page.getByRole("tablist", { name: "Tabs" });
export const tabs = (page: Page) => strip(page).getByRole("tab");
export const focusedAddress = (page: Page) =>
  page.locator('[data-focused="true"] [data-terminal]').getAttribute("data-terminal");
export const selectedIndex = (page: Page) =>
  tabs(page).evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-selected") === "true"));

/** The strip's order as the terminals ⌘1..⌘N select, then the tab that was selected is selected again. */
export async function order(page: Page): Promise<string[]> {
  const count = await tabs(page).count();
  const selected = await selectedIndex(page);
  const select = async (index: number) => {
    await page.keyboard.press(`ControlOrMeta+${index + 1}`);
    await expect(tabs(page).nth(index)).toHaveAttribute("aria-selected", "true");
  };
  const addresses = await Array.from({ length: count }, (_unused, index) => index).reduce<Promise<string[]>>(
    async (previous, index) => {
      const listed = await previous;
      await select(index);
      return [...listed, (await focusedAddress(page)) ?? ""];
    },
    Promise.resolve([]),
  );
  await select(selected);
  return addresses;
}

/** The strip's tab ids in DOM order, read without pressing a key. */
export const domOrder = (page: Page) =>
  strip(page)
    .locator("[data-tab-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-tab-id") ?? ""));

/** Four tabs, the last of them new and selected: the workspace opens one on its own when the core has a live one. */
export async function fourTabs(page: Page): Promise<string[]> {
  await openFour(page);
  return order(page);
}

export async function openFour(page: Page): Promise<void> {
  await page.goto("/");
  await openNewTerminal(page);
  const missing = 4 - (await tabs(page).count());
  await Array.from({ length: missing }).reduce<Promise<unknown>>(
    (previous) => previous.then(() => openNewTerminal(page)),
    Promise.resolve(),
  );
  await expect(tabs(page)).toHaveCount(4);
}

export const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the tab has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, right: box.x + box.width };
};

export async function dragPast(page: Page, from: Locator, past: Locator): Promise<void> {
  const start = await centre(from);
  const end = await centre(past);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.right - 4, end.y, { steps: 16 });
  await page.mouse.up();
}

export const rearranged = (list: readonly string[], indexes: readonly number[]) => indexes.map((index) => list[index]);
