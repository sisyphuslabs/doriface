import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface SidebarSectionProps {
  readonly title: ReactNode;
  readonly count?: number;
  /** Text colour class for the title, e.g. a status colour for "Needs you". */
  readonly tone?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A labelled group in the sidebar. The label names the group; the count is its size. */
export function SidebarSection({ title, count, tone, action, children, className }: SidebarSectionProps) {
  return (
    <section className={cn("flex flex-col gap-px", className)}>
      <header className="flex h-7 items-center gap-2 px-2 text-xs font-medium">
        <h3 className={cn("min-w-0 flex-1 truncate text-muted-foreground", tone)}>{title}</h3>
        {count === undefined ? null : (
          <span data-numeric className="text-muted-foreground">
            {count}
          </span>
        )}
        {action}
      </header>
      {children}
    </section>
  );
}
