import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

/** The open terminal's header: the only place the phone terminal screen names its session (DESIGN.md 5 (e)). */
const header = (page: Page) => page.getByRole("banner");

async function openNewTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await header(page).getByRole("button", { name: "New tab" }).click();
  await expect(page.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });
  await expect(header(page).getByRole("button", { name: "Back to agents" })).toBeVisible();
}

/** The header's one session-actions button; its name carries the title, which a new shell changes from /bin/sh to sh. */
const sessionActions = (page: Page) => header(page).getByRole("button", { name: /^Session actions for / });

async function sessionAction(page: Page, item: string): Promise<void> {
  await sessionActions(page).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("on a phone the open terminal's header renames its session", async ({ page }) => {
  await openNewTerminal(page);
  // A touch target, not the desktop tab strip's 24 px glyph button.
  const box = await sessionActions(page).boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await sessionAction(page, "Rename…");
  const dialog = page.getByRole("dialog", { name: /^Rename / });
  await dialog.getByRole("textbox", { name: "Name" }).fill("phone-rename-check");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(header(page).getByRole("heading", { name: "phone-rename-check" })).toBeVisible();

  await header(page).getByRole("button", { name: "Back to agents" }).click();
  await expect(page.getByText("phone-rename-check").first()).toBeVisible();
});

test("on a phone the open terminal's header ends its session and returns to the list without it", async ({ page }) => {
  await openNewTerminal(page);
  await sessionAction(page, "Rename…");
  await page
    .getByRole("dialog", { name: /^Rename / })
    .getByRole("textbox", { name: "Name" })
    .fill("phone-end-check");
  await page.keyboard.press("Enter");
  await expect(header(page).getByRole("heading", { name: "phone-end-check" })).toBeVisible();
  await expect(header(page).getByRole("button", { name: "Session actions for phone-end-check" })).toBeVisible();

  await sessionAction(page, "End session…");
  const ask = page.getByRole("dialog", { name: "End phone-end-check?" });
  // Destructive and asked first: Enter is not its default.
  await expect(ask.getByRole("button", { name: "End session" })).not.toBeFocused();
  await ask.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("phone-end-check")).toHaveCount(0, { timeout: 15_000 });
});
