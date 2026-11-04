import { cn } from "../lib/cn.ts";
import { caretLeft, type DragState, landingLeft, type Settle, shiftOf } from "./tab-drop-geometry.ts";

const MOTION = "transition-[translate,opacity] duration-(--duration-micro) ease-out";

/** Where a tab is drawn while a drag or its settle is under way, and how it gets there. */
export function placement(id: string, index: number, drag: DragState | null, settle: Settle | null) {
  if (settle?.id === id) {
    return settle.running
      ? { offset: 0, className: cn(MOTION, "motion-reduce:translate-none!") }
      : { offset: settle.offset, className: "motion-reduce:translate-none! motion-reduce:opacity-0" };
  }
  if (drag === null) return { offset: 0, className: "" };
  if (drag.id === id) return { offset: drag.offset, className: "z-10 cursor-grabbing bg-raised shadow-overlay" };
  return { offset: shiftOf(drag, index), className: cn(MOTION, "motion-reduce:translate-none!") };
}

/** The landing place: the gap neighbours open, or a caret where they stay put under reduced motion. */
export function DropIndicator({ drag }: { readonly drag: DragState }) {
  const width = drag.slots[drag.from]?.width ?? 0;
  return (
    <span
      aria-hidden
      data-tab-drop-indicator
      className="pointer-events-none absolute top-1/2 h-7 -translate-y-1/2 rounded-md bg-hover motion-reduce:hidden"
      style={{ left: landingLeft(drag), width }}
    />
  );
}

export function DropCaret({ drag }: { readonly drag: DragState }) {
  return (
    <span
      aria-hidden
      data-tab-drop-caret
      className="pointer-events-none absolute top-1/2 hidden h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ring motion-reduce:block"
      style={{ left: caretLeft(drag) }}
    />
  );
}
