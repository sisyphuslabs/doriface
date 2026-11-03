import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface ScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  /** Marks this as the region's one scroll owner, for layout checks. */
  readonly slot?: string;
}

/** An overlay scrollbar that appears while scrolling; content never loses a gutter to it. */
export function ScrollArea({ children, className, viewportClassName, slot }: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn("relative min-h-0 overflow-hidden", className)}>
      <BaseScrollArea.Viewport
        data-slot={slot}
        className={cn("size-full overscroll-contain outline-none", viewportClassName)}
      >
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2 justify-center p-0.5 opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
      >
        <BaseScrollArea.Thumb className="w-full rounded-full bg-input" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
