import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** Lines of `count` distinct characters from `from` on, 40 to a line. */
function distinct(from: number, count: number): string {
  const chars = Array.from({ length: count }, (_, index) => String.fromCodePoint(from + index));
  const lines = Array.from({ length: Math.ceil(count / 40) }, (_, line) =>
    chars.slice(line * 40, line * 40 + 40).join(""),
  );
  return `${lines.join("\n")}\n`;
}

/** One wheel step up, then two frames so the rows it reveals are drawn. */
async function scrollUp(page: Page): Promise<void> {
  await page.mouse.wheel(0, -600);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("a CJK scrollback sizes each fallback face once, not each glyph: CJK canvas measuring stays under a constant bound", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    // Only measurements of one CJK glyph: other parts of the page (the sidebar fitting its rows) measure their own text.
    const cjk =
      /^[\u{1100}-\u{11FF}\u{3040}-\u{30FF}\u{3130}-\u{318F}\u{3400}-\u{9FFF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}]$/u;
    const counted = window as unknown as { measureTextCalls: number };
    counted.measureTextCalls = 0;
    const measure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (this: CanvasRenderingContext2D, text: string) {
      if (cjk.test(text)) counted.measureTextCalls += 1;
      return measure.call(this, text);
    };
  });
  // 3,000 distinct Hangul syllables and 1,000 distinct ideographs: far more lines than the screen, so most of them are
  // first drawn by scrolling back into them.
  const file = join(mkdtempSync(join(tmpdir(), "wide-measure-")), "cjk.txt");
  writeFileSync(file, distinct(0xac00, 3000) + distinct(0x4e00, 1000));
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`cat ${file}; echo DONE-$((1+1))`);
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".term-row").filter({ hasText: "DONE-2" })).not.toHaveCount(0, { timeout: 60_000 });
  const box = await terminal.boundingBox();
  if (box === null) throw new Error("no terminal box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 6; step++) {
    // oxlint-disable-next-line no-await-in-loop -- each step scrolls on from where the previous one left the view
    await scrollUp(page);
  }
  await expect(terminal.locator(".term-row").filter({ hasText: "\u{AC00}" })).not.toHaveCount(0);
  const measures = await page.evaluate(() => (window as unknown as { measureTextCalls: number }).measureTextCalls);
  // Per font and size, each script block's sample glyph a few times (its own advance, against the default stack, and the
  // fit to whole pixels), at most twice (before and after the web font loads). Measuring per glyph costs thousands here.
  expect(measures).toBeLessThan(50);
});
