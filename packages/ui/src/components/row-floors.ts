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

/** The width of the part's first `count` characters and the ellipsis, in the font the part is drawn in. */
function floorWidth(part: HTMLElement, count: number): number {
  pen ??= document.createElement("canvas").getContext("2d");
  if (pen === null) return 0;
  const text = part.textContent ?? "";
  const characters = [...segmenter.segment(text)].map(({ segment }) => segment);
  const style = getComputedStyle(part);
  pen.font = style.font;
  pen.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  const kept = characters.length <= count ? text : characters.slice(0, count).join("") + ELLIPSIS;
  return Math.ceil(pen.measureText(kept).width);
}

const px = (value: string): number => Number.parseFloat(value) || 0;

const isPart = (value: string | undefined): value is FloorPart =>
  value === "name" || value === "detail" || value === "machine";

/** The width the row has for its parts: its content box minus everything else in it and the gaps between. */
function room(row: HTMLElement, parts: ReadonlySet<Element>): number {
  const style = getComputedStyle(row);
  const children = [...row.children];
  const others = children
    .filter((child) => !parts.has(child))
    .reduce((sum, child) => {
      const own = getComputedStyle(child);
      const grows = px(own.flexGrow) > 0;
      return sum + (grows ? 0 : child.getBoundingClientRect().width) + px(own.marginLeft) + px(own.marginRight);
    }, 0);
  const content = row.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  return content - others - px(style.columnGap) * Math.max(0, children.length - 1);
}

/** Sets each part's min-width to the richest plan the row can hold, so no row runs past its edge. */
function fit(row: HTMLElement): void {
  const parts = [...row.querySelectorAll<HTMLElement>(":scope > [data-floor]")];
  const available = room(row, new Set(parts));
  const sized = PLANS.map((plan) =>
    parts.map((part) => {
      const role = part.dataset["floor"];
      return floorWidth(part, isPart(role) ? plan[role] : 3);
    }),
  );
  const chosen = sized.find((widths) => widths.reduce((sum, width) => sum + width, 0) <= available) ?? sized.at(-1);
  parts.forEach((part, index) => {
    part.style.minWidth = `${chosen?.[index] ?? 0}px`;
  });
}

/**
 * Keeps every `[data-floor]` part of the row a few characters wide before its ellipsis, measured in its own font, and
 * refits when the row resizes, its texts change or a font finishes loading.
 */
export function useRowFloors(row: RefObject<HTMLElement | null>, texts: string): void {
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    const refit = (): void => fit(element);
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, [row, texts]);
}
