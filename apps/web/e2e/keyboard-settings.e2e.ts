import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { fakeSoftKeyboard, PHONE, showKeyboard } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

const keysBar = (page: Page) => page.getByRole("toolbar", { name: "Terminal keys" });

/** The bar's keys in the order it draws them, as the names a screen reader hears. */
async function barNames(bar: Locator): Promise<readonly string[]> {
  return bar
    .locator("button")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
}

async function openSettings(page: Page): Promise<void> {
  await fakeSoftKeyboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Keyboard" }).click();
}

async function openTerminal(page: Page): Promise<Locator> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("banner").getByRole("button", { name: "New tab" }).click();
  const terminal = page.locator("[data-terminal]");
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  // The bar rides on the soft keyboard, which a headless browser has none of: raise the fake one, as a person's does.
  await showKeyboard(page, 336);
  await expect(keysBar(page)).toBeVisible();
  return terminal;
}

test("a pack added in Settings puts its keys in the bar, and the bar keeps that order after a reload", async ({
  page,
}) => {
  await openSettings(page);
  const preview = page.locator("[data-key-bar-preview]");
  await expect(preview.locator('[aria-label="Tmux prefix"]')).toHaveCount(0);

  const tmux = page.locator('[data-pack-row="tmux"]').getByRole("switch");
  await tmux.click();
  await expect(tmux).toHaveAttribute("aria-checked", "true");
  // The preview follows the change at once: the pack's keys are in the bar before the terminal is opened.
  await expect(preview.locator('[aria-label="Tmux prefix"]')).toHaveCount(1);

  // The pack's keys lead: picking a pack in the panel must show its keys, not push them past the person's own.
  const first = preview.locator("button").first();
  await expect(first).toHaveAttribute("aria-label", "Tmux prefix");
  const rows = page.locator("[data-key-row]");
  await expect(rows.first()).toHaveAttribute("data-key-row", "ctrl");
  // The add form scrolled the body: bring the rows back into view before dragging one.
  await page.locator('[data-key-row="ctrl"]').scrollIntoViewIfNeeded();
  const moving = await page.locator('[data-key-row="esc"]').boundingBox();
  const landing = await page.locator('[data-key-row="ctrl"]').boundingBox();
  if (moving === null || landing === null) throw new Error("the key rows were not drawn");
  await page.mouse.move(moving.x + 24, moving.y + moving.height / 2);
  await page.mouse.down();
  await page.mouse.move(landing.x + 24, landing.y - 6, { steps: 10 });
  await page.mouse.up();
  await expect(rows.first()).toHaveAttribute("data-key-row", "esc");

  const terminal = await openTerminal(page);
  const bar = keysBar(page);
  const names = await barNames(bar);
  expect(names.slice(0, 2)).toEqual(["Tmux prefix", "New window"]);
  // The drag's order is the bar's: Escape is now ahead of Control.
  expect(names.indexOf("Escape")).toBeGreaterThan(-1);
  expect(names.indexOf("Escape")).toBeLessThan(names.indexOf("Control"));
  await expect(terminal).toBeVisible();

  // The document is this device's: a reload keeps the order and the pack.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Keyboard" }).click();
  await expect(page.locator("[data-key-row]").first()).toHaveAttribute("data-key-row", "esc");
});

test("a key of the person's own is checked, stored and sent by the bar", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Key label").fill("Shout");
  await page.getByLabel("Keys it sends").fill("echo hello-from-a-key");
  await page.getByRole("button", { name: "Add key" }).click();
  await expect(page.locator("[data-favorite-row]")).toHaveCount(1);
  await expect(page.locator("[data-key-bar-preview]").locator('[aria-label="Shout"]')).toHaveCount(1);

  const terminal = await openTerminal(page);
  await page.getByRole("button", { name: "Shout", exact: true }).click();
  await expect(terminal).toContainText("hello-from-a-key", { timeout: 10_000 });
});

test("an entry that names no key is refused with a reason and stored nowhere", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Key label").fill("Broken");
  await page.getByLabel("Keys it sends").fill("Ctrl+");
  await page.getByRole("button", { name: "Add key" }).click();
  await expect(page.getByText("End the key with what it presses, e.g. Ctrl+X.")).toBeVisible();
  await expect(page.locator("[data-favorite-row]")).toHaveCount(0);
});

test("a key removed from the bar is listed as not in it, and one tap puts it back", async ({ page }) => {
  await openSettings(page);
  const preview = page.locator("[data-key-bar-preview]");
  await expect(preview.locator('[aria-label="Escape"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Escape" }).click();
  await expect(preview.locator('[aria-label="Escape"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Add Escape" }).click();
  await expect(preview.locator('[aria-label="Escape"]')).toHaveCount(1);
});

test("holding Ctrl opens the packs panel without latching it, while a tap still latches", async ({ page }) => {
  await openSettings(page);
  await page.locator('[data-pack-row="tmux"]').getByRole("switch").click();
  await openTerminal(page);
  const ctrl = page.getByRole("button", { name: "Control", exact: true });
  const press = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
  await ctrl.dispatchEvent("pointerdown", { ...press, buttons: 1 });
  const panel = page.getByRole("dialog", { name: "Shortcut packs" });
  await expect(panel).toBeVisible({ timeout: 3000 });
  // The page behind a modal is inert, so the bar is read again once the panel closes.
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await ctrl.dispatchEvent("pointerup", { ...press, buttons: 0 });
  // The hold opened the panel; it did not latch the modifier the person was aiming at.
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  await ctrl.click();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
});
