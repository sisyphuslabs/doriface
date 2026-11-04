import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface RowWithActionsProps {
  /** The row's own button; it stays the list's stop, and ArrowRight reaches the actions (see the sidebar's roving). */
  readonly row: ReactElement;
  /** Shown over the row's trailing meta on hover, keyboard focus, or while one of their menus is open. */
  readonly actions: ReactNode;
  readonly className?: string;
}

const SHOWN = "group-hover/row:visible group-focus-within/row:visible group-has-[[data-popup-open]]/row:visible";
const MASKED = "[&:is(:hover,:focus-within,:has([data-popup-open]))_[data-row-meta]]:invisible";

/** A sidebar row with a few trailing actions that take the place of its meta (age, machine, count) when shown. */
export function RowWithActions({ row, actions, className }: RowWithActionsProps) {
  return (
    <div className={cn("group/row relative flex min-w-0 items-center", MASKED, className)}>
      {row}
      <span className={cn("invisible absolute inset-y-0 right-1 flex items-center gap-0.5", SHOWN)}>{actions}</span>
    </div>
  );
}
