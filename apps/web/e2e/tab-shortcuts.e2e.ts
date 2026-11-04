import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const tabs = (page: Page) => page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");

/** The chord each tab's tooltip advertises, as Playwright presses it: "(⌘3)" or "(Ctrl+3)" becomes "ControlOrMeta+3". */
const advertised = (page: Page) =>
  tabs(page).evaluateAll((elements) =>
    elements.map((element) => {
      const digit = /\((?:⌘|Ctrl\+)(\d)\)$/.exec(element.getAttribute("title") ?? "")?.[1];
      return digit === undefined ? null : `ControlOrMeta+${digit}`;
    }),
  );

/** Presses each chord in turn and checks that it selected the tab that advertised it. */
const pressEach = (page: Page, chords: readonly (string | null)[]) =>
  chords.reduce<Promise<void>>(
    (previous, chord, index) =>
      previous.then(async () => {
        await page.locator('[data-focused="true"] [data-terminal]').getByRole("textbox").focus();
        await page.keyboard.press(chord ?? "");
        await expect(tabs(page).nth(index)).toHaveAttribute("aria-selected", "true");
      }),
    Promise.resolve(),
  );

test("each tab's tooltip names the chord that selects that tab, split or not", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  await openNewTerminal(page);
  const unsplit = (await advertised(page)).slice(0, 9);
  expect(unsplit.length).toBeGreaterThanOrEqual(3);
  expect(unsplit).toEqual(unsplit.map((_chord, index) => `ControlOrMeta+${index + 1}`));
  await pressEach(page, unsplit);

  await page.getByRole("button", { name: "Split" }).click();
  const split = (await advertised(page)).slice(0, 9);
  expect(split).toEqual(unsplit);
  await pressEach(page, split);
});
