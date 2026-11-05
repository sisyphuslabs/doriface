import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const HANGUL = "\u{BE0C}\u{B77C}";

/** Prints `text` in the terminal, typed as UTF-8 octal so the keyboard input stays ASCII. */
async function print(page: Page, terminal: Locator, text: string): Promise<void> {
  const octal = [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8)}`).join("");
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '${octal}\\n'`);
  await page.keyboard.press("Enter");
}

const wideSizes = (terminal: Locator) =>
  terminal.evaluate((element) =>
    [...element.querySelectorAll(".term-row:not(.term-scrollback-row) .term-wide")].map(
      (span) => getComputedStyle(span).fontSize,
    ),
  );

const webFontLoaded = (page: Page) =>
  page.evaluate(() =>
    [...document.fonts].some((face) => face.family.includes("JetBrains") && face.status === "loaded"),
  );

/** Holds every web font response until the returned function is called. */
async function holdWebFonts(page: Page): Promise<() => void> {
  const gate = Promise.withResolvers<void>();
  await page.route("**/*.woff2", async (route) => {
    await gate.promise;
    await route.continue();
  });
  return gate.resolve;
}

/** The wide-glyph sizes a page that loaded its web font before drawing any Hangul gets: the reference. */
async function referenceSizes(page: Page): Promise<readonly string[]> {
  const fresh = await page.context().newPage();
  await fresh.goto("/");
  const terminal = await openNewTerminal(fresh);
  await fresh.evaluate(() => document.fonts.ready);
  await print(fresh, terminal, HANGUL);
  await expect.poll(async () => (await wideSizes(terminal)).length).toBe(2);
  const sizes = await wideSizes(terminal);
  await fresh.close();
  return sizes;
}

test("a web font that loads while no terminal is mounted re-sizes wide glyphs measured before it loaded", async ({
  page,
}) => {
  const release = await holdWebFonts(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await print(page, terminal, HANGUL);
  await expect.poll(async () => (await wideSizes(terminal)).length).toBe(2);
  const before = await wideSizes(terminal);
  // Settings replaces the terminal view, so no view is mounted when the font arrives.
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.locator("[data-terminal]")).toHaveCount(0);
  release();
  await expect.poll(() => webFontLoaded(page), { timeout: 15_000 }).toBe(true);
  await page.getByRole("button", { name: "Close settings" }).first().click();
  const back = page.locator('[data-focused="true"] [data-terminal]');
  await expect(back).toContainText("$", { timeout: 20_000 });
  await print(page, back, HANGUL);
  await expect.poll(async () => (await wideSizes(back)).length).toBe(4);
  const reference = await referenceSizes(page);
  // The held font changes the metrics: the sizes measured before it loaded are not the reference.
  expect(before).not.toEqual(reference);
  expect(await wideSizes(back)).toEqual([...reference, ...reference]);
});

test("a web font that loads while a terminal is mounted re-sizes the wide glyphs already drawn", async ({ page }) => {
  const release = await holdWebFonts(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await print(page, terminal, HANGUL);
  await expect.poll(async () => (await wideSizes(terminal)).length).toBe(2);
  const before = await wideSizes(terminal);
  release();
  await expect.poll(() => webFontLoaded(page), { timeout: 15_000 }).toBe(true);
  const reference = await referenceSizes(page);
  expect(before).not.toEqual(reference);
  await expect.poll(() => wideSizes(terminal), { timeout: 10_000 }).toEqual(reference);
});
