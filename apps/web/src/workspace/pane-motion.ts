import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Direction } from "../layout/neighbor.ts";
import type { Rect } from "../layout/rects.ts";
import type { Bump } from "./use-layout.ts";

/** DESIGN.md section 6: a pane moves at Standard (220 ms) and a nudge at Micro (120 ms), both on `--ease-out`. */
const DURATION = 220;
const NUDGE_DURATION = 120;
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const NUDGE: Readonly<Record<Direction, string>> = {
  left: "translateX(-4px)",
  right: "translateX(4px)",
  up: "translateY(-4px)",
  down: "translateY(4px)",
};

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface PaneMotion {
  readonly rect: Rect;
  /** How the pane arrived: grown out of the pane it split (`row`: from the left edge, `column`: from the top), or null. */
  readonly grow: "row" | "column" | null;
  readonly bump: Bump | null;
}

/**
 * Moves a pane to its new rectangle with transforms only (FLIP), so a terminal never re-measures mid-animation: the
 * box takes its final size at once and the drawing slides from where it was. A new pane grows from the edge it was
 * split from, and a key that cannot move focus nudges the focused pane toward that edge.
 */
export function usePaneMotion(ref: RefObject<HTMLElement | null>, { rect, grow, bump }: PaneMotion): void {
  const last = useRef<Rect | null>(null);
  const bumped = useRef(bump?.seq ?? 0);
  useLayoutEffect(() => {
    const element = ref.current;
    const before = last.current;
    last.current = rect;
    if (element === null || rect.width === 0 || rect.height === 0) return;
    if (before === null) {
      if (grow === null) return;
      if (reduced()) {
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: EASE });
        return;
      }
      const from = grow === "row" ? "scaleX(0.02)" : "scaleY(0.02)";
      element.animate(
        [
          { transform: from, transformOrigin: "0 0", opacity: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: DURATION,
          easing: EASE,
        },
      );
      return;
    }
    if (reduced() || before.width === 0 || before.height === 0) return;
    const [dx, dy] = [before.x - rect.x, before.y - rect.y];
    const [sx, sy] = [before.width / rect.width, before.height / rect.height];
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.002 && Math.abs(sy - 1) < 0.002) return;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "0 0" }, { transform: "none" }],
      { duration: DURATION, easing: EASE },
    );
  }, [ref, rect, grow]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (bump === null || bump.seq === bumped.current || element === null) return;
    bumped.current = bump.seq;
    const keyframes = reduced()
      ? [{ opacity: 1 }, { opacity: 0.7 }, { opacity: 1 }]
      : [{ transform: "none" }, { transform: NUDGE[bump.direction] }, { transform: "none" }];
    element.animate(keyframes, { duration: NUDGE_DURATION, easing: EASE });
  }, [ref, bump]);
}
