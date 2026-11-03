import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** The address of the terminal whose input holds DOM focus, read from document.activeElement. */
const focusedAddress = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement
      ? (active.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null)
      : null;
  });

test("clicking New tab puts keyboard focus in the new terminal", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  const opened = await openNewTerminal(page);
  await expect.poll(() => focusedAddress(page)).toBe(await opened.getAttribute("data-terminal"));
});

test("opening a terminal from the sidebar puts keyboard focus in it", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  // After a reload only the first live terminal has a tab, so another sidebar row opens a new one.
  await page.reload();
  const shown = page.locator('[data-focused="true"] [data-terminal]');
  await expect(shown).toContainText("$", { timeout: 15_000 });
  const before = await shown.getAttribute("data-terminal");
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await sidebar.locator("button:not([aria-current])").filter({ hasText: "·" }).first().click();
  await expect(shown).not.toHaveAttribute("data-terminal", before ?? "");
  await expect(shown).toContainText("$", { timeout: 15_000 });
  await expect.poll(() => focusedAddress(page)).toBe(await shown.getAttribute("data-terminal"));
});

test("dismissing the palette gives keyboard focus back to the terminal", async ({ page }) => {
  await page.goto("/");
  const opened = await openNewTerminal(page);
  await opened.getByRole("textbox").focus();
  await page.getByRole("button", { name: "Command palette" }).first().click();
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expect.poll(() => focusedAddress(page)).toBe(await opened.getAttribute("data-terminal"));
});

test("dismissing the palette over the paste dialog leaves focus in that dialog, not the shell behind it", async ({
  page,
}) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const input = terminal.getByRole("textbox");
  await input.focus();
  await input.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "echo one\necho two\n");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const paste = page.getByRole("dialog", { name: /Paste 3 lines/ });
  await expect(paste).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+P");
  // The paste dialog marks everything outside it aria-hidden, the palette included.
  const palette = page.getByRole("combobox", { name: "Command", includeHidden: true });
  await expect(palette).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(paste).toBeVisible();
  await expect.poll(() => paste.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.type("qqleak");
  await expect(terminal).not.toContainText("qqleak");
});
