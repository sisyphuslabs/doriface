import { useLayoutEffect, type RefObject } from "react";

/** The texts of a row that shrink to an ellipsis, from the one that keeps its characters longest. */
export type FloorPart = "name" | "detail" | "machine";

/**
 * How many characters each part keeps, tried in order until the row holds them: five of each, then the machine gives
 * way to three, then the detail, then the name.
 */
const PLANS: readonly Readonly<Record<FloorPart, number>>[] = [
  { name: 5, detail: 5, machine: 5 },
  { name: 5, detail: 5, machine: 3 },
  { name: 5, detail: 3, machine: 3 },
  { name: 3, detail: 3, machine: 3 },
];

const ELLIPSIS = "\u2026";
const segmenter = new Intl.Segmenter();
let pen: CanvasRenderingContext2D | null | undefined;

/**
 * The width of a text's first `count` characters and the ellipsis, never more than the whole text: an ellipsis is
 * wider than many a character, so a name one character past the floor would otherwise get a floor wider than itself
 * and push a gap in after it.
 */
export function floorFor(text: string, count: number, width: (text: string) => number): number {
  const characters = [...segmenter.segment(text)].map(({ segment }) => segment);
  const whole = width(text);
  if (characters.length <= count) return Math.ceil(whole);
  return Math.ceil(Math.min(whole, width(characters.slice(0, count).join("") + ELLIPSIS)));
}

/** The floor of a part in the font it is drawn in. */
function floorWidth(part: HTMLElement, count: number): number {
  pen ??= document.createElement("canvas").getContext("2d");
  if (pen === null) return 0;
  const style = getComputedStyle(part);
  pen.font = style.font;
  pen.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  const font = pen;
  return floorFor(part.textContent ?? "", count, (text) => font.measureText(text).width);
}

const px = (value: string): number => Number.parseFloat(value) || 0;

const isPart = (value: string | undefined): value is FloorPart =>
  value === "name" || value === "detail" || value === "machine";

/** The width of the row's content box, as a ResizeObserver reports it. */
function contentWidth(row: HTMLElement, style: CSSStyleDeclaration): number {
  const edges = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth];
  return row.getBoundingClientRect().width - edges.reduce((sum, edge) => sum + px(edge), 0);
}

/** The width the row has for its parts: its content box minus everything else in it and the gaps between. */
function room(row: HTMLElement, style: CSSStyleDeclaration, content: number, parts: ReadonlySet<Element>): number {
  const children = [...row.children];
  const others = children
    .filter((child) => !parts.has(child))
    .reduce((sum, child) => {
      const own = getComputedStyle(child);
      const grows = px(own.flexGrow) > 0;
      return sum + (grows ? 0 : child.getBoundingClientRect().width) + px(own.marginLeft) + px(own.marginRight);
    }, 0);
  return content - others - px(style.columnGap) * Math.max(0, children.length - 1);
}

interface Fit {
  readonly row: HTMLElement;
  readonly content: number;
  readonly parts: readonly HTMLElement[];
  readonly widths: readonly number[];
}

/** The richest plan the row can hold, from reads only, so many rows can be measured before any of them is written. */
function measure(row: HTMLElement): Fit {
  const style = getComputedStyle(row);
  const content = contentWidth(row, style);
  const parts = [...row.querySelectorAll<HTMLElement>(":scope > [data-floor]")];
  const available = room(row, style, content, new Set(parts));
  const sized = PLANS.map((plan) =>
    parts.map((part) => {
      const role = part.dataset["floor"];
      return floorWidth(part, isPart(role) ? plan[role] : 3);
    }),
  );
  return { row, content, parts, widths: choose(sized, available) };
}

const total = (widths: readonly number[]): number => widths.reduce((sum, width) => sum + width, 0);

/**
 * The richest plan the room holds. When even the narrowest does not fit, its widths shrink in proportion to the room:
 * the parts keep fewer characters, but the row never runs past its edge, so every row's age still ends at one edge.
 */
function choose(sized: readonly (readonly number[])[], available: number): readonly number[] {
  const fits = sized.find((widths) => total(widths) <= available);
  if (fits !== undefined) return fits;
  const narrowest = sized.at(-1) ?? [];
  const scale = Math.max(0, available) / Math.max(1, total(narrowest));
  return narrowest.map((width) => Math.floor(width * scale));
}

/** Every row on the page that keeps floors, and the content width it was last fitted at. */
const fitted = new Map<HTMLElement, number>();
const pending = new Set<HTMLElement>();
let observer: ResizeObserver | undefined;

/**
 * Fits rows in two phases, every read and then every write, so a refit of many rows costs one layout rather than one
 * per row: a write between two rows' reads would make the second read lay the page out again.
 */
function fitAll(rows: Iterable<HTMLElement>): void {
  const fits = [...rows].filter((row) => fitted.has(row) && row.isConnected).map(measure);
  for (const { row, content, parts, widths } of fits) {
    fitted.set(row, content);
    parts.forEach((part, index) => {
      part.style.minWidth = `${widths[index] ?? 0}px`;
    });
  }
}

/** Fits the rows that mounted or changed text in this commit together, before the browser paints. */
function schedule(row: HTMLElement): void {
  if (pending.size === 0) {
    queueMicrotask(() => {
      const rows = [...pending];
      pending.clear();
      fitAll(rows);
    });
  }
  pending.add(row);
}

/** Refits only the rows whose width changed, so the observer's first report after a fit does no work. */
function resized(entries: readonly ResizeObserverEntry[]): void {
  const changed = entries.flatMap(({ target, contentRect }) => {
    const last = target instanceof HTMLElement ? fitted.get(target) : undefined;
    return target instanceof HTMLElement && last !== undefined && Math.abs(last - contentRect.width) >= 0.5
      ? [target]
      : [];
  });
  if (changed.length > 0) fitAll(changed);
}

const refitEvery = (): void => fitAll(fitted.keys());

function track(row: HTMLElement): void {
  if (observer === undefined) {
    observer = new ResizeObserver(resized);
    document.fonts.addEventListener("loadingdone", refitEvery);
  }
  fitted.set(row, Number.NaN);
  observer.observe(row);
}

function untrack(row: HTMLElement): void {
  fitted.delete(row);
  pending.delete(row);
  observer?.unobserve(row);
}

/**
 * Keeps every `[data-floor]` part of the row a few characters wide before its ellipsis, measured in its own font, and
 * refits when the row resizes, its texts change or a font finishes loading. Every row shares one observer and one
 * batched fit.
 */
export function useRowFloors(row: RefObject<HTMLElement | null>, texts: string): void {
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    track(element);
    schedule(element);
    return () => untrack(element);
  }, [row, texts]);
}
