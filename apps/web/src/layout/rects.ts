import { childrenOf, idOf, pixelsOf, typeOf, weightOf, type Node } from "@doriface/protocol/layout";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The line between two neighbours of a row or column, where dragging resizes them. */
export interface Divider {
  readonly container: string;
  /** The neighbour before the line; the one after it is `index + 1`. */
  readonly index: number;
  readonly axis: "row" | "column";
  readonly rect: Rect;
}

export interface Arrangement {
  readonly panes: ReadonlyMap<string, Rect>;
  readonly dividers: readonly Divider[];
  /** Each row's and column's own box: a divider drag measures its move against it. */
  readonly containers: ReadonlyMap<string, Rect>;
}

const shown = (node: Node): boolean => node["hidden"] !== true;

/** A stack shows its `active` child (herdr-app's `active_child`): the named one when shown, else the first shown. */
function visibleChildren(node: Node): readonly Node[] {
  const children = childrenOf(node).filter(shown);
  if (typeOf(node) !== "stack") return children;
  const active = children.find((child) => idOf(child) === node["active"]) ?? children[0];
  return active === undefined ? [] : [active];
}

/** Lengths along one axis: pixel-sized children first, the rest shared by weight. */
function lengths(children: readonly Node[], total: number): number[] {
  const fixed = children.reduce((sum, child) => sum + (pixelsOf(child) ?? 0), 0);
  const weights = children.map((child) => (pixelsOf(child) === null ? Math.max(0, weightOf(child) ?? 1) : 0));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const free = Math.max(0, total - fixed);
  return children.map((child, index) => {
    const px = pixelsOf(child);
    if (px !== null) return Math.min(px, total);
    return weightSum === 0 ? 0 : (free * (weights[index] ?? 0)) / weightSum;
  });
}

interface Placed {
  readonly panes: Map<string, Rect>;
  readonly dividers: Divider[];
  readonly containers: Map<string, Rect>;
}

function place(node: Node, box: Rect, gap: number, out: Placed): void {
  const type = typeOf(node);
  if (type === "block") {
    out.panes.set(idOf(node), box);
    return;
  }
  const children = visibleChildren(node);
  if (type === "stack") {
    for (const child of children) place(child, box, gap, out);
    return;
  }
  const row = type === "row";
  out.containers.set(idOf(node), box);
  const total = (row ? box.width : box.height) - gap * Math.max(0, children.length - 1);
  const sizes = lengths(children, Math.max(0, total));
  let offset = row ? box.x : box.y;
  children.forEach((child, index) => {
    const length = sizes[index] ?? 0;
    const rect = row
      ? { x: offset, y: box.y, width: length, height: box.height }
      : { x: box.x, y: offset, width: box.width, height: length };
    place(child, rect, gap, out);
    offset += length;
    if (index < children.length - 1) {
      const line = row
        ? { x: offset, y: box.y, width: gap, height: box.height }
        : { x: box.x, y: offset, width: box.width, height: gap };
      out.dividers.push({ container: idOf(node), index, axis: row ? "row" : "column", rect: line });
      offset += gap;
    }
  });
}

/**
 * Where each pane and divider of a tab's tree sits inside `box`, in pixels. A zoomed pane (private to this screen, as
 * in herdr-app) takes the whole box and no divider is shown.
 */
export function arrange(root: Node, box: Rect, gap: number, zoomed: string | null = null): Arrangement {
  const out: Placed = { panes: new Map(), dividers: [], containers: new Map() };
  place(root, box, gap, out);
  if (zoomed !== null && out.panes.has(zoomed))
    return { panes: new Map([[zoomed, box]]), dividers: [], containers: out.containers };
  return out;
}
