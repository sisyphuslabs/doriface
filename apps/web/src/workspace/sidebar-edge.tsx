import { cn } from "@doriface/ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { dragTo, MAX_SIDEBAR_WIDTH, RAIL_BELOW, type Layout } from "./layout.ts";

const STEP = 16;

export interface SidebarEdgeProps {
  readonly width: number;
  readonly rail: boolean;
  /** The rail's width as drawn, for the separator's value. */
  readonly railWidth: number;
  readonly onChange: (patch: Partial<Pick<Layout, "sidebarWidth" | "rail">>) => void;
  /** True while a drag is under way, so the width follows the pointer without easing. */
  readonly onDragging: (dragging: boolean) => void;
}

/**
 * The sidebar's right edge: drag it narrower than 160 px for the icon rail, or back out for the full sidebar. As a
 * window splitter it takes the keyboard too: arrows step 16 px, Enter turns the rail on or off.
 */
export function SidebarEdge({ width, rail, railWidth, onChange, onDragging }: SidebarEdgeProps) {
  const start = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    setActive(true);
    onDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (start.current === null) return;
    onChange(dragTo(event.clientX - start.current));
  };
  const end = (): void => {
    if (start.current === null) return;
    start.current = null;
    setActive(false);
    onDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter") onChange({ rail: !rail });
    else if (event.key === "ArrowRight") onChange(rail ? { rail: false } : dragTo(width + STEP));
    else if (event.key === "ArrowLeft" && !rail) onChange(dragTo(width - STEP));
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={railWidth}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={rail ? railWidth : width}
      aria-valuetext={rail ? "Icon rail" : `${width} pixels`}
      aria-description={`Narrower than ${RAIL_BELOW} pixels it becomes an icon rail. Enter toggles the rail.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:right-0 after:w-px after:transition-colors after:duration-(--duration-micro)",
        "hover:after:bg-ring focus-visible:after:w-0.5 focus-visible:after:bg-ring",
        active && "after:bg-ring",
      )}
    />
  );
}
