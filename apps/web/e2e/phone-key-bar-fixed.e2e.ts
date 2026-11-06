import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { expectTouchTargets, key, keysBar, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

const scroller = (page: Page) => page.locator('[data-slot="terminal-keys-scroll"]');
const box = async (item: Locator) => await item.boundingBox();

const SCROLLED = [
  "Control",
  "Shift",
  "Tab",
  "Escape",
  "Arrow left",
  "Arrow up",
  "Arrow down",
  "Arrow right",
  "Switch session",
  "Paste",
] as const;
const FIXED = ["Type in a field", "Hide keyboard"] as const;

test("the row scrolls every key, and the two slots beside it never do", async ({ page }) => {
  await openPhoneTerminal(page);
  await Promise.all(
    SCROLLED.map((name) => expect(scroller(page).getByRole("button", { name, exact: true })).toHaveCount(1)),
  );
  await Promise.all(
    FIXED.map((name) => expect(scroller(page).getByRole("button", { name, exact: true })).toHaveCount(0)),
  );
  await expectTouchTargets(keysBar(page));

  const row = scroller(page);
  const width = await row.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(width.scroll).toBeGreaterThan(width.client);

  // The input field's key sits beside the keyboard's, and scrolling the row to its end moves neither.
  const before = await Promise.all(FIXED.map(async (name) => await box(key(page, name))));
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(width.scroll - width.client);
  const after = await Promise.all(FIXED.map(async (name) => await box(key(page, name))));
  expect(after).toEqual(before);
  for (const slot of after) {
    expect(slot?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((slot?.x ?? 0) + (slot?.width ?? Infinity)).toBeLessThanOrEqual(390);
  }
  const [field, keyboard] = after;
  expect((field?.x ?? 0) + (field?.width ?? 0)).toBeLessThanOrEqual(keyboard?.x ?? 0);
  expect(keyboard?.x ?? 0).toBeGreaterThan(390 - 60);
});

test("scrolled-in keys and the fixed slots both reach the terminal", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await page.keyboard.type("cat -v\r");
  await key(page, "Arrow left").click();
  await key(page, "Arrow up").click();
  await key(page, "Arrow down").click();
  await key(page, "Arrow right").click();
  await page.keyboard.type("q\r");
  await expect(terminal).toContainText(/\^\[\[D\^\[\[A\^\[\[B\^\[\[Cq/, { timeout: 15_000 });

  await key(page, "Type in a field").click();
  await expect(page.getByLabel("Type into the terminal")).toBeFocused();
  await key(page, "Hide keyboard").click();
  await expect(keysBar(page)).toHaveCount(0);
});

test("ctrl and shift stay latched for the arrow that follows them", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await page.keyboard.type("cat -v\r");
  const ctrl = key(page, "Control");
  const shift = key(page, "Shift");
  await ctrl.click();
  await shift.click();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await expect(shift).toHaveAttribute("aria-pressed", "true");
  await key(page, "Arrow right").click();
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  await expect(shift).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.type("q\r");
  await expect(terminal).toContainText(/\^\[\[1;6Cq/, { timeout: 15_000 });
});
