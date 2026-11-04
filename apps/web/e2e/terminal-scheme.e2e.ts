import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

/** The theme's terminal background token and the open terminal's painted background, both as computed rgb(). */
const backgrounds = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--term-bg").trim();
    document.body.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    const terminal = document.querySelector('[data-focused="true"] .wterm');
    return { token, terminal: terminal === null ? null : getComputedStyle(terminal).backgroundColor };
  });

/** Switches the system's scheme, waits for the theme token to change, then for the terminal to paint it. */
async function switchTo(page: Page, scheme: "light" | "dark", before: string): Promise<string> {
  await page.emulateMedia({ colorScheme: scheme });
  await expect.poll(async () => (await backgrounds(page)).token).not.toBe(before);
  const { token } = await backgrounds(page);
  await expect.poll(async () => (await backgrounds(page)).terminal, { message: `terminal on ${scheme}` }).toBe(token);
  return token;
}

test("the open terminal follows a live light/dark switch both ways, keeping its view and scrollback", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("seq 1 80; echo scheme-$((2+3))\r");
  await expect(terminal).toContainText("scheme-5", { timeout: 20_000 });
  const light = await backgrounds(page);
  expect(light.terminal).toBe(light.token);
  // Marks this view: a remount would replace the element and drop the mark.
  await page.evaluate(() =>
    Object.assign(document.querySelector('[data-focused="true"] .wterm') ?? {}, { kept: true }),
  );
  const rows = await terminal.locator(".term-row").count();

  const dark = await switchTo(page, "dark", light.token);
  await switchTo(page, "light", dark);

  expect(
    await page.evaluate(() => Reflect.get(document.querySelector('[data-focused="true"] .wterm') ?? {}, "kept")),
  ).toBe(true);
  expect(await terminal.locator(".term-row").count()).toBe(rows);
  await expect(terminal).toContainText("scheme-5");
});
