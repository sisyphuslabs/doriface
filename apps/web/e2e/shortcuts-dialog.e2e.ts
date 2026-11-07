import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

/** herdr-app's app.help chord: Cmd+/ on macOS, Ctrl+? (Ctrl+Shift+/) elsewhere. */
const HELP_CHORD = process.platform === "darwin" ? "Meta+Slash" : "Control+Shift+Slash";

/** The address of the terminal whose input holds DOM focus. */
const focusedTerminal = (page: Page) =>
  page.evaluate(() =>
    document.activeElement instanceof HTMLTextAreaElement
      ? (document.activeElement.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null)
      : null,
  );

test("the help chord lists the person's own keys, the same chord closes it, and focus goes back", async ({ page }) => {
  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Keybindings" })
    .or(page.getByRole("button", { name: "Keybindings" }))
    .first()
    .click();
  await page.getByRole("button", { name: "Record a shortcut for Command palette" }).click();
  await expect(page.getByRole("status")).toHaveText("Press keys…");
  await page.keyboard.press("Control+Alt+K");
  await expect(page.getByText("Changed")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).first().click();

  const terminal = await openNewTerminal(page);
  const address = await terminal.getAttribute("data-terminal");
  await terminal.getByRole("textbox").focus();
  await expect.poll(() => focusedTerminal(page)).toBe(address);

  await page.keyboard.press(HELP_CHORD);
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "App" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Terminal" })).toBeVisible();
  const palette = dialog.getByRole("listitem").filter({ hasText: "Command palette" });
  await expect(palette.locator("kbd").filter({ hasText: /^CtrlAltK$/ })).toBeVisible();

  await page.keyboard.press(HELP_CHORD);
  await expect(dialog).toBeHidden();
  await expect.poll(() => focusedTerminal(page)).toBe(address);
});
