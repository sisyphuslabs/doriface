import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

/** A Ctrl chord as an input method can report it: the letter of the active layout in `key`, the physical key in `code`. */
async function chord(page: Page, key: string, code: string): Promise<void> {
  await page.evaluate(
    (pressed) => {
      const target = document.activeElement ?? document.body;
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, { ...pressed, ctrlKey: true, bubbles: true, cancelable: true }));
      }
    },
    { key, code },
  );
}

test("a Ctrl chord whose key reads as a Hangul letter sends the physical key's control byte (#652)", async ({
  page,
}) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  // cat -v prints every byte it reads, control bytes as ^X, once a line ends.
  await page.keyboard.type("cat -v\r");
  await chord(page, "ㅁ", "KeyA");
  await chord(page, "ㄹ", "KeyF");
  await chord(page, "ㅠ", "KeyB");
  // A Latin key keeps the path it always had.
  await chord(page, "e", "KeyE");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("^A^F^B^E", { timeout: 10_000 });
});
