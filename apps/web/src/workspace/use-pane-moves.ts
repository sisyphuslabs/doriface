import { childrenOf, editTab, equalize, nodeAt, pathTo, resizeAt, type Node } from "@doriface/protocol/layout";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { paneMove, type Direction } from "../layout/neighbor.ts";
import { arrange } from "../layout/rects.ts";
import type { View } from "../layout/view.ts";
import type { LayoutPane, LayoutTab } from "./layout-model.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

export interface Bump {
  readonly pane: string;
  readonly direction: Direction;
  readonly seq: number;
}

/** What moves focus between panes and changes their sizes and zoom in the tab in view. */
export interface PaneMoves {
  /**
   * Focuses the nearest pane that way in the tab in view. With no pane that way in a split tab it nudges the focused
   * pane (`bumped`) instead and still takes the key; a lone pane leaves the key to its program (false), as Ghostty does.
   */
  readonly go: (direction: Direction) => boolean;
  readonly bumped: Bump | null;
  /** Moves the line between children `index` and `index + 1` of a row or column of the tab in view by `delta`. */
  readonly resize: (container: string, index: number, delta: number) => void;
  /** Moves the focused pane's nearest edge that way by one step, as Ghostty's `resize_split`. */
  readonly resizeFocused: (direction: Direction) => boolean;
  readonly equalize: () => boolean;
  readonly toggleZoom: () => boolean;
}

export interface PaneMovesContext {
  readonly active: LayoutTab | null;
  readonly focused: LayoutPane | null;
  readonly layoutOf: (machine: string | null) => MachineLayout | undefined;
  readonly show: (key: string, pane: string | null) => void;
  readonly setView: Dispatch<SetStateAction<View>>;
  readonly history: ReadonlyMap<string, readonly string[]>;
}

/** Proportions are all moving focus needs, so it measures the tree in a fixed box with the panes' gap. */
const MEASURE = { x: 0, y: 0, width: 1600, height: 1000 } as const;
/** A keyboard resize step: a twentieth of the row or column, about Ghostty's ten cells on a laptop screen. */
export const RESIZE_STEP = 0.05;

export function usePaneMoves({ active, focused, layoutOf, show, setView, history }: PaneMovesContext): PaneMoves {
  const [bumped, setBumped] = useState<Bump | null>(null);
  const go = useCallback(
    (direction: Direction): boolean => {
      if (active === null || focused === null) return false;
      const { panes } = arrange(active.root, MEASURE, 8, null);
      const move = paneMove(focused.id, direction, panes, history.get(active.key) ?? []);
      if (move.kind === "pass") return false;
      if (move.kind === "bump") setBumped((prev) => ({ pane: focused.id, direction, seq: (prev?.seq ?? 0) + 1 }));
      else show(active.key, move.to);
      return true;
    },
    [active, focused, show],
  );

  // Pane sizes are shared in the herdr-app document, as herdr-app keeps them; this is the one place that writes them,
  // so keeping them per device instead would change only this function.
  const editSizes = useCallback(
    (change: (root: Node) => Node | null): boolean => {
      if (active === null || active.transient) return false;
      const layout = layoutOf(active.machine);
      if (layout === undefined || layout.readOnly !== null) return false;
      const id = active.id;
      void layout.edit((doc) => (doc === null ? null : editTab(doc, id, change)));
      return true;
    },
    [active, layoutOf],
  );

  const resize = useCallback(
    (container: string, index: number, delta: number): void => {
      editSizes((root) => resizeAt(root, container, index, delta));
    },
    [editSizes],
  );

  const resizeFocused = useCallback(
    (direction: Direction): boolean => {
      if (active === null || focused === null) return false;
      const edge = nearestEdge(active.root, focused.id, direction);
      return edge === null ? false : editSizes((root) => resizeAt(root, edge.container, edge.index, edge.delta));
    },
    [active, editSizes, focused],
  );

  const equalizeTab = useCallback((): boolean => (active === null ? false : editSizes(equalize)), [active, editSizes]);

  const toggleZoom = useCallback((): boolean => {
    if (active === null || focused === null || active.panes.length < 2) return false;
    const key = active.key;
    const pane = focused.id;
    setView((prev) => {
      const { [key]: was, ...others } = prev.zoomed;
      return { ...prev, zoomed: was === pane ? others : { ...others, [key]: pane } };
    });
    return true;
  }, [active, focused]);

  return { go, bumped, resize, resizeFocused, equalize: equalizeTab, toggleZoom };
}

/** The line Ghostty's `resize_split` moves: in the nearest row (left, right) or column (up, down) around the pane. */
function nearestEdge(
  root: Node,
  pane: string,
  direction: Direction,
): { readonly container: string; readonly index: number; readonly delta: number } | null {
  const path = pathTo(root, pane);
  if (path === null) return null;
  const axis = direction === "left" || direction === "right" ? "row" : "column";
  const forward = direction === "right" || direction === "down";
  for (let depth = path.length - 1; depth >= 0; depth -= 1) {
    const container = nodeAt(root, path.slice(0, depth));
    const at = path[depth];
    if (container === null || at === undefined || container["type"] !== axis) continue;
    const count = childrenOf(container).length;
    if (count < 2) continue;
    const index = at < count - 1 ? at : at - 1;
    return { container: String(container["id"]), index, delta: forward ? RESIZE_STEP : -RESIZE_STEP };
  }
  return null;
}
