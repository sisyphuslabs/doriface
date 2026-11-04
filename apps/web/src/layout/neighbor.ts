import type { Rect } from "./rects.ts";

export type Direction = "left" | "right" | "up" | "down";

interface Candidate {
  readonly id: string;
  readonly gap: number;
  readonly recent: number;
  readonly overlap: number;
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Compares two lengths, treating ones within a pixel as equal (subpixel split noise). */
const compare = (a: number, b: number): number => (Math.abs(a - b) < 1 ? 0 : Math.sign(a - b));

function measure(from: Rect, to: Rect, direction: Direction): { gap: number; overlap: number } {
  const across = (): number => overlap(from.y, from.y + from.height, to.y, to.y + to.height);
  const along = (): number => overlap(from.x, from.x + from.width, to.x, to.x + to.width);
  switch (direction) {
    case "left":
      return { gap: from.x - (to.x + to.width), overlap: across() };
    case "right":
      return { gap: to.x - (from.x + from.width), overlap: across() };
    case "up":
      return { gap: from.y - (to.y + to.height), overlap: along() };
    case "down":
      return { gap: to.y - (from.y + from.height), overlap: along() };
  }
}

/**
 * The pane to move to from `from`, herdr-app's `nearest`: the closest pane past that edge that overlaps it across the
 * other axis; among equally close ones the most recently focused (`history`, oldest first), then the one that
 * overlaps most, then the first in tree order. Null when nothing lies that way.
 */
export function nearest(
  from: string,
  direction: Direction,
  panes: ReadonlyMap<string, Rect>,
  history: readonly string[] = [],
): string | null {
  const origin = panes.get(from);
  if (origin === undefined) return null;
  let best: Candidate | null = null;
  for (const [id, rect] of panes) {
    if (id === from) continue;
    const { gap, overlap: shared } = measure(origin, rect, direction);
    if (gap <= -2 || shared <= 0) continue;
    const next = { id, gap, recent: history.lastIndexOf(id), overlap: shared };
    const better =
      best === null ||
      (compare(next.gap, best.gap) || Math.sign(best.recent - next.recent) || compare(best.overlap, next.overlap)) < 0;
    if (better) best = next;
  }
  return best?.id ?? null;
}
