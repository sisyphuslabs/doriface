import { cn } from "../lib/cn.ts";

/** The one overlay level: popover tone, hairline, a single shadow, 120 ms scale-fade from its origin. */
export const overlaySurface = cn(
  "rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay outline-none",
  "origin-(--transform-origin) transition-[opacity,transform] duration-(--duration-micro) ease-out",
  "data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0",
);

export const backdropClass = cn(
  "fixed inset-0 bg-black/40 transition-opacity duration-(--duration-standard)",
  "data-starting-style:opacity-0 data-ending-style:opacity-0",
);
