import type { WTerm } from "@wterm/react";
import { useEffect, useRef } from "react";
import { heldSelection, holdSelection, onHeldSelection, releaseSelection } from "./held-selection.ts";

/** The design system's touch hold (a list row's is the same): shorter is a tap, longer is a drag. */
export const LONG_PRESS_MS = 300;
/** A finger that travels this far first was scrolling, not holding: the press stays a scroll. */
const MOVE_TOLERANCE_PX = 10;
/** A press this soon after a touch that opened the selection menu is still part of it. */
const TOUCH_MENU_MS = 2000;

export interface TerminalSelection {
  /** The selected text; empty when the hold landed where there was nothing to select, and the menu offers Paste. */
  readonly text: string;
  /** Where the finger left the screen, in viewport px: where the menu opens. */
  readonly at: { readonly x: number; readonly y: number };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Edge {
  readonly node: Node;
  readonly offset: number;
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/** The grid's own cell width, which wterm sets on the terminal as it lays the rows out. */
function cellWidthOf(element: HTMLElement): number {
  return parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width")) || 0;
}

/** Everything a caret needs: a text node of one row and how many of its characters sit before the point. */
function offsetInRow(row: HTMLElement, at: Point): { readonly node: Text; readonly offset: number } | null {
  const doc = row.ownerDocument;
  const cell = cellWidthOf(row);
  const walker = doc.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let best: { readonly node: Text; readonly offset: number; readonly distance: number } | null = null;
  for (let walk = walker.nextNode(); walk !== null; walk = walker.nextNode()) {
    if (!(walk instanceof Text)) continue;
    const box = doc.createRange();
    box.selectNodeContents(walk);
    const rect = box.getBoundingClientRect();
    const distance = at.x < rect.left ? rect.left - at.x : at.x > rect.right ? at.x - rect.right : 0;
    if (best !== null && distance >= best.distance) continue;
    const length = walk.textContent?.length ?? 0;
    // A run of ASCII has one character per cell; a wide glyph is one character over the cells it spans.
    const inside = Math.max(0, Math.min(rect.width, at.x - rect.left));
    const offset = length <= 1 ? (inside > rect.width / 2 ? 1 : 0) : Math.round(inside / (rect.width / length));
    best = { node: walk, offset: Math.max(0, Math.min(length, offset)), distance };
  }
  if (best === null) return null;
  // A row wider than its glyphs: the point past the last run takes the row's end.
  return cell > 0 || best.distance === 0 ? { node: best.node, offset: best.offset } : null;
}

/**
 * The caret under a point, from the rows' own geometry: the row the finger is on (the nearest one when it is between
 * rows), and the character in it at the finger's column. The point may sit over the terminal's hidden input instead of
 * a row, which is why this reads the rows rather than the browser's own caret lookup.
 */
function caretAt(element: HTMLElement, at: Point): Range | null {
  const rows = [...element.querySelectorAll<HTMLElement>(".term-row")];
  if (rows.length === 0) return null;
  const nearest = rows.reduce(
    (best, row) => {
      const box = row.getBoundingClientRect();
      const distance = at.y < box.top ? box.top - at.y : at.y > box.bottom ? at.y - box.bottom : 0;
      return distance < best.distance ? { row, distance } : best;
    },
    { row: rows[0] as HTMLElement, distance: Number.POSITIVE_INFINITY },
  );
  const point = offsetInRow(nearest.row, at);
  if (point === null) return null;
  const range = element.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  return range;
}

/** The caret at `at` on `row`, or null when the row has no text to put it in. */
function wordRangeAt(doc: Document, caret: Range): Range | null {
  const node = caret.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const offset = Math.min(caret.startOffset, text.length);
  const isWord = (index: number): boolean =>
    index >= 0 && index < text.length && WORD_CHARACTER.test(text.slice(index, index + 1));
  let start = offset;
  let end = offset;
  if (isWord(start) || (start > 0 && isWord(start - 1))) {
    if (!isWord(start)) start -= 1;
    while (isWord(start - 1)) start -= 1;
    end = start;
    while (isWord(end)) end += 1;
  } else if (start < text.length) {
    end = start + 1;
  } else if (start > 0) {
    start -= 1;
  } else {
    return null;
  }
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

function edgesOf(range: Range): { readonly start: Edge; readonly end: Edge } {
  return {
    start: { node: range.startContainer, offset: range.startOffset },
    end: { node: range.endContainer, offset: range.endOffset },
  };
}

/** A range from the held word to the caret the finger is over, or null where the two cannot be compared. */
function extendTo(doc: Document, anchor: { readonly start: Edge; readonly end: Edge }, caret: Range): Range | null {
  try {
    const whole = doc.createRange();
    whole.setStart(anchor.start.node, anchor.start.offset);
    whole.setEnd(anchor.end.node, anchor.end.offset);
    const before = whole.comparePoint(caret.startContainer, caret.startOffset) < 0;
    const range = doc.createRange();
    if (before) {
      range.setStart(caret.startContainer, caret.startOffset);
      range.setEnd(anchor.end.node, anchor.end.offset);
    } else {
      range.setStart(anchor.start.node, anchor.start.offset);
      range.setEnd(caret.startContainer, caret.startOffset);
    }
    return range;
  } catch {
    return null;
  }
}

/**
 * A held touch selects terminal text (#195): resting a finger on a word selects it, dragging from there extends the
 * selection, and letting go opens the selection menu. A tap still types and a swipe still scrolls, because nothing is
 * taken from the page until the hold has become a selection. The selection is held by the terminal rather than the
 * document (held-selection.ts), so the input method keeps composing after one.
 */
export function useTouchSelection(
  wt: WTerm | null,
  onSelection: ((selection: TerminalSelection | null) => void) | undefined,
): void {
  const report = useRef(onSelection);
  report.current = onSelection;
  const enabled = onSelection !== undefined;
  useEffect(() => {
    if (wt === null || !enabled) return undefined;
    const element = wt.element;
    const doc = element.ownerDocument;
    const abort = new AbortController();
    let timer = 0;
    let press: { readonly id: number; readonly at: Point } | null = null;
    let anchor: { readonly start: Edge; readonly end: Edge } | null = null;
    let selecting = false;
    let touchedAt = Number.NEGATIVE_INFINITY;

    const publish = (selection: TerminalSelection | null): void => report.current?.(selection);
    const stopTimer = (): void => {
      window.clearTimeout(timer);
      timer = 0;
    };
    const begin = (at: Point): void => {
      timer = 0;
      selecting = true;
      const caret = caretAt(element, at);
      const word = caret === null || !element.contains(caret.startContainer) ? null : wordRangeAt(doc, caret);
      if (word === null) {
        anchor = null;
        return;
      }
      anchor = edgesOf(word);
      holdSelection(element, word);
      doc.getSelection()?.removeAllRanges();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== "touch" || event.button !== 0) return;
      touchedAt = performance.now();
      stopTimer();
      releaseSelection(element);
      press = { id: event.pointerId, at: { x: event.clientX, y: event.clientY } };
      anchor = null;
      selecting = false;
      const at = press.at;
      timer = window.setTimeout(() => begin(at), LONG_PRESS_MS);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (press === null || event.pointerId !== press.id) return;
      const at = { x: event.clientX, y: event.clientY };
      if (!selecting) {
        if (Math.hypot(at.x - press.at.x, at.y - press.at.y) > MOVE_TOLERANCE_PX) {
          stopTimer();
          press = null;
        }
        return;
      }
      const caret = caretAt(element, at);
      if (caret === null || anchor === null || !element.contains(caret.startContainer)) return;
      const next = extendTo(doc, anchor, caret);
      if (next !== null) holdSelection(element, next);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (press === null || event.pointerId !== press.id) return;
      stopTimer();
      press = null;
      if (!selecting) return;
      selecting = false;
      const at = { x: event.clientX, y: event.clientY };
      const text = heldSelection(element)?.text ?? "";
      // The compatibility mouse events a touch sends follow this one in the same task, and a menu opened now would be
      // dismissed by that mouse's press: it opens on the task after them.
      window.setTimeout(() => publish({ text, at }), 0);
    };
    const onPointerCancel = (event: PointerEvent): void => {
      if (press === null || event.pointerId !== press.id) return;
      stopTimer();
      press = null;
      selecting = false;
    };
    const onTouchMove = (event: TouchEvent): void => {
      if (selecting) event.preventDefault();
    };
    const onContextMenu = (event: MouseEvent): void => {
      if (selecting || performance.now() - touchedAt < TOUCH_MENU_MS) event.preventDefault();
    };
    const onScroll = (): void => {
      if (heldSelection(element) !== null) publish(null);
    };
    element.addEventListener("pointerdown", onPointerDown, { signal: abort.signal });
    element.addEventListener("pointermove", onPointerMove, { signal: abort.signal });
    element.addEventListener("pointerup", onPointerUp, { signal: abort.signal });
    element.addEventListener("pointercancel", onPointerCancel, { signal: abort.signal });
    element.addEventListener("touchmove", onTouchMove, { passive: false, signal: abort.signal });
    element.addEventListener("contextmenu", onContextMenu, { signal: abort.signal });
    element.addEventListener("scroll", onScroll, { signal: abort.signal, passive: true });
    const stopHeld = onHeldSelection(element, () => {
      if (heldSelection(element) === null) publish(null);
    });
    return () => {
      stopTimer();
      stopHeld();
      abort.abort();
      releaseSelection(element);
    };
  }, [wt, enabled]);
}
