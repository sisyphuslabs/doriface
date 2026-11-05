import { childrenOf, MIN_SHARE, type Node, nodeAt, pathTo, weightOf } from "@doriface/protocol/layout";

/** A divider's place in its row or column and how far `resizeAt` can move it, each in percent of that container. */
export interface LinePosition {
  readonly now: number;
  readonly min: number;
  readonly max: number;
}

/**
 * The line between children `index` and `index + 1`: it moves only those two, each keeping MIN_SHARE of the container,
 * so it can reach from the start of the first plus that floor to the end of the second less it.
 */
export function linePosition(root: Node, container: string, index: number): LinePosition {
  const path = pathTo(root, container);
  const node = path === null ? null : nodeAt(root, path);
  const weights = (node === null ? [] : childrenOf(node)).map((child) => weightOf(child) ?? 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { now: 0, min: 0, max: 100 };
  const percent = (weight: number): number => (100 * weight) / total;
  const start = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const [a = 0, b = 0] = [weights[index], weights[index + 1]];
  const floor = MIN_SHARE * total;
  return { now: percent(start + a), min: percent(start + floor), max: percent(start + a + b - floor) };
}
