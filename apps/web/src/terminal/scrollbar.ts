/**
 * A terminal's scroll position in rows, and its scrollbar's geometry, as herdr-app draws it (`src/terminal.rs`,
 * `scrollbar_thumb`, `scrollbar_row_at`, `scrollbar_grab_at`): the scrollable area is `total` rows, the `len`-row
 * viewport sits `offset` rows from its top.
 */
export interface ScrollRows {
  readonly total: number;
  readonly offset: number;
  readonly len: number;
}

/** A thumb's top and length in px inside a `track` px lane; null when nothing scrolls. `min` keeps it grabbable. */
export function scrollbarThumb(
  rows: ScrollRows,
  track: number,
  min: number,
): { readonly top: number; readonly length: number } | null {
  const { total, offset, len } = rows;
  if (total <= len || len <= 0 || track <= 0) return null;
  const length = Math.min(Math.max((track * len) / total, Math.min(min, track)), track);
  const travel = track - length;
  const top = travel <= 0 ? 0 : (Math.min(Math.max(offset, 0), total - len) / (total - len)) * travel;
  return { top, length };
}

/** Where a press at `y` grabs the thumb: the px into it, or its middle when the press is on the track beside it. */
export function scrollbarGrabAt(top: number, length: number, y: number): number {
  return y >= top && y < top + length ? y - top : length / 2;
}

/** The row offset (from the scrollback's top) a thumb dragged to `top` px lands on. */
export function scrollbarRowAt(total: number, len: number, track: number, min: number, top: number): number {
  const thumb = scrollbarThumb({ total, offset: 0, len }, track, min);
  if (thumb === null) return 0;
  const travel = track - thumb.length;
  if (travel <= 0) return 0;
  return Math.round((Math.min(Math.max(top, 0), travel) / travel) * (total - len));
}

/** What a scroll element and its grid say about where the view is. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly rowHeight: number;
  /** Rows on screen (the grid's). */
  readonly rows: number;
  /** Rows above the screen (the core's scrollback). */
  readonly scrollback: number;
}

/** Below the bottom by less than this many px counts as at the bottom, as wterm counts it. */
const AT_BOTTOM_PX = 5;

export const maxScrollTop = (box: ScrollBox): number => Math.max(0, box.scrollHeight - box.clientHeight);

export const atBottom = (box: ScrollBox): boolean => maxScrollTop(box) - box.scrollTop < AT_BOTTOM_PX;

/** The view's rows: at the bottom it sits exactly on the last row, whatever the padding left over below it. */
export function scrollRows(box: ScrollBox): ScrollRows {
  const total = box.scrollback + box.rows;
  const offset = atBottom(box) ? box.scrollback : Math.min(box.scrollTop / box.rowHeight, box.scrollback);
  return { total, offset, len: box.rows };
}

/** Scrolled up from the bottom by more than one row: the view is in the scrollback, not following the output. */
export const awayFromBottom = (box: ScrollBox): boolean => maxScrollTop(box) - box.scrollTop > box.rowHeight;

/** Herdr's scroll targets (`ScrollTarget`): whole lines, pages of the grid's rows, or either end. */
export type ScrollTarget = { readonly lines: number } | { readonly pages: number } | { readonly to: "top" | "bottom" };

/** The scrollTop a target lands on, from the box as it is; a row offset is exact, in whole rows. */
export function scrollTopFor(box: ScrollBox, target: ScrollTarget): number {
  const max = maxScrollTop(box);
  if ("to" in target) return target.to === "top" ? 0 : max;
  const lines = "lines" in target ? target.lines : Math.round(target.pages * box.rows);
  const from = scrollRows(box).offset;
  const row = Math.min(Math.max(Math.round(from) + lines, 0), box.scrollback);
  return row >= box.scrollback ? max : row * box.rowHeight;
}

/** The scrollTop that shows `row` (from the scrollback's top) on the first screen line; the last one is the bottom. */
export const scrollTopAtRow = (box: ScrollBox, row: number): number =>
  row >= box.scrollback ? maxScrollTop(box) : Math.max(0, row) * box.rowHeight;
