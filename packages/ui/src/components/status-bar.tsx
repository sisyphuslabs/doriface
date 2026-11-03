import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface StatusBarProps {
  readonly start: ReactNode;
  readonly end?: ReactNode;
  readonly className?: string;
}

/** The 28 px footer: where you are on the left, how to act on the right. */
export function StatusBar({ start, end, className }: StatusBarProps) {
  return (
    <footer
      className={cn(
        "flex h-(--statusbar-height) shrink-0 items-center gap-4 border-t border-border bg-chrome px-3.5 text-xs text-muted-foreground [&_svg]:size-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">{start}</div>
      {end === undefined ? null : <div className="flex shrink-0 items-center gap-3">{end}</div>}
    </footer>
  );
}

export function StatusBarItem({ icon, children }: { readonly icon?: ReactNode; readonly children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate">
      {icon}
      {children}
    </span>
  );
}
