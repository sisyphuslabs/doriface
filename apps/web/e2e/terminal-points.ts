import type { Locator } from "@playwright/test";
import type { TouchPoint } from "./touch.ts";

/** The middle of `needle`'s first appearance on the terminal row that holds `row`, in page px. */
export async function pointOn(terminal: Locator, row: string, needle: string): Promise<TouchPoint> {
  return terminal.evaluate(
    (root, [wanted, text]) => {
      const line = [...root.querySelectorAll(".term-row")].find(
        (candidate) => candidate.textContent?.includes(wanted) === true,
      );
      if (line === undefined) throw new Error(`no row holds ${wanted}`);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(text) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }
      throw new Error(`${text} is not on the row holding ${wanted}`);
    },
    [row, needle] as const,
  );
}

/** A point past `row`'s last text, where a drag to the end of the line lands. */
export async function rowEnd(terminal: Locator, row: string): Promise<TouchPoint> {
  return terminal.evaluate((root, wanted) => {
    const line = [...root.querySelectorAll(".term-row")].find(
      (candidate) => candidate.textContent?.includes(wanted) === true,
    );
    if (line === undefined) throw new Error(`no row holds ${wanted}`);
    const box = line.getBoundingClientRect();
    return { x: box.right - 4, y: box.top + box.height / 2 };
  }, row);
}
