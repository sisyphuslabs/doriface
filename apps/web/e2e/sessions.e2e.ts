import type { Page } from "@playwright/test";
import { expect, openNewTerminal, terminalCount, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const liveCount = async (page: Page): Promise<number> => (await terminalCount(page)).before;

const pane = (page: Page) => page.locator('[data-focused="true"]');

/** The close button of the selected tab, which sits beside it in the tab's pill. */
const closeSelected = (page: Page) =>
  page
    .getByRole("tab", { selected: true })
    .locator("xpath=..")
    .getByRole("button", { name: /^Close / });

/** The session actions sit in the tab strip beside Split and act on the focused terminal. */
async function sessionMenu(page: Page, item: string): Promise<void> {
  await page.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("a pane has no title bar: the tab names the terminal and the status bar names its space", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect(pane(page).getByRole("heading")).toHaveCount(0);
  await expect(pane(page).getByRole("button", { name: "Session actions" })).toHaveCount(0);
  // A new shell's title moves from its argv (/bin/sh) to the program's name (sh): read the pane and the button together.
  const sessionActions = page.getByRole("button", { name: /^Session actions for / });
  await expect
    .poll(async () => {
      const title = (await pane(page).getAttribute("aria-label"))?.replace(/ terminal$/, "");
      return (await sessionActions.getAttribute("aria-label")) === `Session actions for ${title}`;
    })
    .toBe(true);
  // Which chord: tab-shortcuts.e2e.ts presses each tab's and checks it selects that tab.
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("title", /\((⌘|Ctrl\+)\d\)$/);
  await expect(page.getByRole("contentinfo").locator("[data-status-space]")).not.toBeEmpty();
});

test("renaming a session from the tab strip updates the tab", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await sessionMenu(page, "Rename…");
  const dialog = page.getByRole("dialog", { name: /^Rename / });
  await dialog.getByRole("textbox", { name: "Name" }).fill("deploy-check");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "deploy-check" })).toBeVisible();
  await expect(pane(page)).toHaveAttribute("aria-label", "deploy-check terminal");
});

test("ending a session from the tab strip stops the program", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  const before = await liveCount(page);
  await sessionMenu(page, "End session…");
  await page.getByRole("dialog", { name: /^End / }).getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("contentinfo")).toContainText(`${before - 1} terminal`, { timeout: 15_000 });
});

test("closing a tab asks whether to keep the session running or end it", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  const kept = await liveCount(page);
  const ask = page.getByRole("dialog", { name: /^Close .+\?$/ });
  await closeSelected(page).click();
  await ask.getByRole("button", { name: "Keep running" }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByRole("contentinfo")).toContainText(`${kept} terminal`);

  await openNewTerminal(page);
  const before = await liveCount(page);
  await closeSelected(page).click();
  await ask.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("contentinfo")).toContainText(`${before - 1} terminal`, { timeout: 15_000 });
});

test("End session in the close prompt is styled destructive and Enter does not end the session", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await sessionMenu(page, "End session…");
  const confirm = page.getByRole("dialog", { name: /^End / });
  const destructive = await confirm
    .getByRole("button", { name: "End session" })
    .evaluate((button) => getComputedStyle(button).backgroundColor);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  const before = await liveCount(page);
  await closeSelected(page).click();
  const ask = page.getByRole("dialog", { name: /^Close .+\?$/ });
  const end = ask.getByRole("button", { name: "End session" });
  expect(await end.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(destructive);
  await page.keyboard.press("Enter");
  await expect(ask).toBeHidden();
  await expect(page.getByRole("contentinfo")).toContainText(`${before} terminal`);
  await expect(page.getByRole("tab", { selected: true })).toBeVisible();
});
