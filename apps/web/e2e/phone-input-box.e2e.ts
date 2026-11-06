import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { key, keysBar, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

const field = (page: Page) => page.getByLabel("Type into the terminal");
const value = (page: Page) => page.locator("[data-terminal]").evaluate((el) => el.textContent ?? "");

/** Types a Hangul syllable the way the phone's keyboard composes one: the input method owns it until it commits. */
async function compose(page: Page, syllable: string): Promise<void> {
  await page.evaluate((text) => {
    const input = document.querySelector('textarea[aria-label="Type into the terminal"]');
    if (!(input instanceof HTMLTextAreaElement)) throw new Error("the input field is not on the page");
    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    input.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: text }));
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(input, `${input.value}${text}`);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: false, data: text }));
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
  }, syllable);
}

test("the field takes Korean through the input method, and Send writes the line and presses Return", async ({
  page,
}) => {
  const terminal = await openPhoneTerminal(page);
  await key(page, "Type in a field").click();
  await expect(field(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  await page.keyboard.type("echo 인사-$((6*7))");
  await expect(field(page)).toHaveValue("echo 인사-$((6*7))");
  await key(page, "Send").click();
  await expect(field(page)).toHaveValue("");
  await expect(terminal).toContainText("인사-42", { timeout: 15_000 });
  await expect(field(page)).toBeFocused();
});

test("a composed syllable reaches the program as one word, and nothing is sent before Send", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await key(page, "Type in a field").click();
  await page.keyboard.type("echo ");
  await compose(page, "한글");
  await expect(field(page)).toHaveValue("echo 한글");
  // The terminal keeps what it had: the field holds the line, not the shell.
  expect(await value(page)).not.toContain("한글");

  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("한글", { timeout: 15_000 });
  await expect(field(page)).toHaveValue("");
});

test("the field rides above the keys bar, and the keyboard's own key takes both away", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await key(page, "Type in a field").click();
  await expect(field(page)).toBeVisible();
  const [box, bar, term] = await Promise.all([
    field(page).boundingBox(),
    keysBar(page).boundingBox(),
    terminal.boundingBox(),
  ]);
  // The field sits on the bar, and the terminal ends above the field: neither covers the other.
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) + 1);
  expect((term?.y ?? 0) + (term?.height ?? 0)).toBeLessThanOrEqual((box?.y ?? 0) + 1);

  await key(page, "Hide keyboard").click();
  await expect(field(page)).toHaveCount(0);
  await expect(keysBar(page)).toHaveCount(0);
  await key(page, "Show keyboard").click();
  await expect(keysBar(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
  await expect(key(page, "Type in a field")).toHaveAttribute("aria-pressed", "false");
});
