import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import { wideGlyphScaler } from "./face-scales.ts";
import { CodepointWidths, type PreeditCodepoint, preeditRange } from "./preedit.ts";

/** The cells a preedit is drawn in, built as the renderer builds a row's cells so a wide one gets its fitted size. */
function preeditRow(element: HTMLElement, codepoints: readonly PreeditCodepoint[]): HTMLElement {
  const row = element.ownerDocument.createElement("div");
  row.className = "term-row term-preedit";
  row.setAttribute("aria-hidden", "true");
  const scale = wideGlyphScaler(element);
  for (const codepoint of codepoints) {
    const cell = element.ownerDocument.createElement("span");
    if (codepoint.wide) {
      cell.className = "term-wide";
      const factor = scale?.(codepoint.text) ?? 1;
      if (factor !== 1) cell.style.fontSize = `${factor}em`;
    }
    cell.textContent = codepoint.text;
    row.appendChild(cell);
  }
  return row;
}

/**
 * Draws the text an input method is composing as Ghostty does (renderer/generic.zig): as cells at the cursor, a wide
 * codepoint over two cells at the size its committed glyph will have, underlined, shifted left at the row's end, over the
 * cells it covers, and with no cursor drawn meanwhile. The input element keeps the composition; it only stops painting it
 * (#674).
 */
export function usePreedit(wt: WTerm | null): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const element = wt.element;
    const input = element.querySelector("textarea");
    if (input === null) return undefined;
    const widths = new CodepointWidths();
    let shown: HTMLElement | null = null;
    let generation = 0;
    const clear = (): void => {
      generation += 1;
      shown?.remove();
      shown = null;
      delete element.dataset["preedit"];
    };
    const draw = async (text: string): Promise<void> => {
      const mine = (generation += 1);
      const codepoints = await widths.of(text);
      const bridge = wt.bridge;
      const first = element.querySelector<HTMLElement>(".term-row:not(.term-scrollback-row)");
      if (mine !== generation || bridge === null || first === null) return;
      const cell = Number.parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width"));
      if (!(cell > 0)) return;
      const cols = bridge.getCols();
      const cursor = bridge.getCursor();
      const range = preeditRange(codepoints, Math.min(cursor.col, cols - 1), cols - 1);
      const row = preeditRow(element, codepoints.slice(range.offset));
      const host = element.getBoundingClientRect();
      const grid = first.getBoundingClientRect();
      row.style.left = `${grid.left - host.left - element.clientLeft + element.scrollLeft + range.start * cell}px`;
      row.style.top = `${grid.top - host.top - element.clientTop + element.scrollTop + cursor.row * grid.height}px`;
      shown?.remove();
      shown = row;
      element.dataset["preedit"] = "";
      element.appendChild(row);
    };
    const onUpdate = (event: CompositionEvent): void => {
      if (event.data === "") clear();
      else void draw(event.data);
    };
    input.addEventListener("compositionupdate", onUpdate);
    input.addEventListener("compositionend", clear);
    input.addEventListener("blur", clear);
    return () => {
      input.removeEventListener("compositionupdate", onUpdate);
      input.removeEventListener("compositionend", clear);
      input.removeEventListener("blur", clear);
      clear();
      widths.dispose();
    };
  }, [wt]);
}
