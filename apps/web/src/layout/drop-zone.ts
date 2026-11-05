import type { Edge } from "@doriface/protocol/layout";
import type { Rect } from "./rects.ts";

/** Where a dragged pane lands on another: beside it on an edge, or in its place (the two swap). */
export type Zone = Edge | "swap";

/** The share of a pane's width or height, from each edge, that picks that edge; the middle swaps. */
const EDGE_SHARE = 0.25;

/**
 * herdr-app's `drop_zone`: a point in the outer quarter of `rect` picks the nearest edge, the middle swaps, and a point
 * outside it (or an empty rect) is no drop at all.
 */
export function dropZone(rect: Rect, x: number, y: number): Zone | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return null;
  const fx = (x - rect.x) / rect.width;
  const fy = (y - rect.y) / rect.height;
  const sides: readonly (readonly [number, Edge])[] = [
    [fx, "left"],
    [1 - fx, "right"],
    [fy, "top"],
    [1 - fy, "bottom"],
  ];
  const [distance, edge] = sides.reduce((nearest, side) => (side[0] < nearest[0] ? side : nearest));
  return distance < EDGE_SHARE ? edge : "swap";
}

/** The part of the target a drop there will take, as herdr-app previews it: the half on that edge, or all of it. */
export function dropPreview(rect: Rect, zone: Zone): Rect {
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  switch (zone) {
    case "left":
      return { ...rect, width: halfWidth };
    case "right":
      return { ...rect, x: rect.x + halfWidth, width: halfWidth };
    case "top":
      return { ...rect, height: halfHeight };
    case "bottom":
      return { ...rect, y: rect.y + halfHeight, height: halfHeight };
    case "swap":
      return rect;
  }
}
