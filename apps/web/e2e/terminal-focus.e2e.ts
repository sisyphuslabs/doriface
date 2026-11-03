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
  // New shells report no state, so they list under Idle; the one without aria-current has no tab yet.
  await sidebar.getByRole("region", { name: "Idle" }).locator("button:not([aria-current])").first().click();
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

  // The backdrop is the other way to dismiss it with a pointer.
  await page.getByRole("button", { name: "Command palette" }).first().click();
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  // The top-left corner is backdrop: the palette sits centred near the top.
  await page.mouse.click(5, 5);
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
  // The dialog moves focus into itself just after it opens; the palette is opened from there.
  await expect.poll(() => paste.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
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

test("closing the palette with its shortcut or by running an action gives focus back to the terminal", async ({
  page,
}) => {
  await page.goto("/");
  const opened = await openNewTerminal(page);
  const address = await opened.getAttribute("data-terminal");
  const palette = page.getByRole("combobox", { name: "Command" });

  await opened.getByRole("textbox").focus();
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await expect(palette).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await expect(palette).toBeHidden();
  await expect.poll(() => focusedAddress(page)).toBe(address);

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.getByRole("option", { name: /^Larger terminal text/ }).click();
  await expect(palette).toBeHidden();
  await expect.poll(() => focusedAddress(page)).toBe(address);
});
