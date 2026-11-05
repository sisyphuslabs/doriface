import type { WTerm } from "@wterm/dom";
import { useEffect } from "react";
import { selectedCells } from "./selection-cells.ts";

/** The layer the selected cells are painted in, inside the grid, above the cell backgrounds and below the text. */
const LAYER = "term-selection-cells";

/**
 * Paints the document selection over this terminal as whole cells (#410). The browser's own highlight follows each
 * glyph's box, so a wide character drawn by a fallback face, at its own size, paints taller or narrower than its two
 * cells; render-css.ts turns that highlight off inside rows, and this layer paints the cells instead, as Ghostty does.
 */
export function useSelectionCells(wt: WTerm | null): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const doc = wt.element.ownerDocument;
    const layer = doc.createElement("div");
    layer.className = LAYER;
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;user-select:none;z-index:-1;";
    let frame = 0;
    const paint = (): void => {
      frame = 0;
      const grid = wt.element.querySelector<HTMLElement>(".term-grid");
      const selection = doc.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const cell = parseFloat(getComputedStyle(wt.element).getPropertyValue("--term-cell-width")) || 0;
      const rects = grid === null || range === null ? [] : selectedCells(range, grid, cell, wt.cols);
      if (rects.length === 0) {
        layer.replaceChildren();
        return;
      }
      // wterm clears the grid when it sets up again (a resize), so the layer goes back in each time it paints.
      if (layer.parentNode !== grid && grid !== null) grid.appendChild(layer);
      layer.replaceChildren(
        ...rects.map((rect) => {
          const cellRun = doc.createElement("div");
          cellRun.style.cssText = `position:absolute;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;background:var(--term-selection-bg, rgb(80 140 255 / 30%));`;
          return cellRun;
        }),
      );
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };
    doc.addEventListener("selectionchange", schedule);
    const resized = new ResizeObserver(schedule);
    resized.observe(wt.element);
    return () => {
      doc.removeEventListener("selectionchange", schedule);
      resized.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      layer.remove();
    };
  }, [wt]);
}
