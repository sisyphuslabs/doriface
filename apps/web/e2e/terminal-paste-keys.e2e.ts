import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { endOwnTerminals } from "./own-terminals.ts";

endOwnTerminals();

test.use({ serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Presses a key as Chrome on Linux delivers it: a keydown that carries the browser's own `paste` editing command, which
 * runs unless the page cancels the keydown. Playwright's `keyboard.press` sends no editing command on Linux.
 */
async function pressPasteKey(page: Page, key: "ctrl+shift+v" | "shift+insert"): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [modifiers, name, code, keyCode] =
    key === "ctrl+shift+v" ? [2 | 8, "V", "KeyV", 86] : [8, "Insert", "Insert", 45];
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers,
    key: name,
    code,
    windowsVirtualKeyCode: keyCode,
    commands: ["paste"],
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers,
    key: name,
    code,
    windowsVirtualKeyCode: keyCode,
  });
  await cdp.detach();
}

for (const key of ["ctrl+shift+v", "shift+insert"] as const) {
  test(`${key} pastes the clipboard into the terminal, not a key code (#510)`, async ({ page }) => {
    await page.goto("/");
    const terminal = await openNewTerminal(page);
    await terminal.getByRole("textbox").focus();
    await page.evaluate(() => navigator.clipboard.writeText("pasted-$((6*7))"));
    await page.keyboard.type("echo ");
    await pressPasteKey(page, key);
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("pasted-42", { timeout: 15_000 });
  });
}
