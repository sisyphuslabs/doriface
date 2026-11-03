import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface SettingRowProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control: ReactNode;
  readonly id?: string;
  readonly className?: string;
}

/** A settings line: what it is on the left, the control on the right; stacks under 480 px. */
export function SettingRow({ title, description, control, id, className }: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border py-3.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-[min(16rem,100%)] flex-1">
        <p id={id} className="text-base text-foreground">
          {title}
        </p>
        {description === undefined ? null : <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex max-w-full shrink-0 items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1 sm:[&>*]:flex-none">
        {control}
      </div>
    </div>
  );
}
