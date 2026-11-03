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

test.describe("with clipboard access", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("selecting text with the mouse keeps keyboard focus in the terminal and copy still works", async ({ page }) => {
    await page.goto("/");
    const terminal = await openNewTerminal(page);
    const address = await terminal.getAttribute("data-terminal");
    await terminal.getByRole("textbox").focus();
    await page.keyboard.type("echo copysrc-$((6*7))-end");
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("copysrc-42-end", { timeout: 15_000 });

    // The drag runs across the output line's own glyphs, as a user would select it.
    const box = await terminal.evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf("copysrc-42-end") ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + "copysrc-42-end".length);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
      }
      return null;
    });
    if (box === null) throw new Error("the output line is not in the terminal");
    await page.mouse.move(box.left + 1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.right - 1, box.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? "")).toContain("copysrc-42");

    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("copysrc-42");
    await expect.poll(() => focusedAddress(page)).toBe(address);
    await page.keyboard.type("echo after-$((2+3))");
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("after-5", { timeout: 15_000 });
  });
});

test("clicking Split moves keyboard focus into the new pane, and clicking it again back to the terminal", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  const first = await openNewTerminal(page);
  const firstAddress = await first.getAttribute("data-terminal");
  const split = page.getByRole("button", { name: "Split" });

  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "true");
  const shown = page.locator("[data-terminal]:visible");
  await expect(shown).toHaveCount(2);
  const other = (await shown.evaluateAll((els) => els.map((el) => el.getAttribute("data-terminal")))).find(
    (address) => address !== firstAddress,
  );
  await expect.poll(() => focusedAddress(page)).toBe(other);

  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "false");
  const remaining = page.locator("[data-terminal]:visible");
  await expect(remaining).toHaveCount(1);
  const address = await remaining.getAttribute("data-terminal");
  await expect.poll(() => focusedAddress(page)).toBe(address);
  // Enter typed here must reach the shell, not press Split again.
  await page.keyboard.type("echo unsplit-$((3+4))");
  await page.keyboard.press("Enter");
  await expect(remaining).toContainText("unsplit-7", { timeout: 15_000 });
  await expect(split).toHaveAttribute("aria-pressed", "false");
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
