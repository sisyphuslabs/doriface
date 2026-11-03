import { Ban } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface SettingRowProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control: ReactNode;
  /** The config file key this row writes, e.g. a Ghostty key; shown as a monospace label. */
  readonly configKey?: string;
  /** Why this setting cannot apply here, in words. The row stays visible, its control is disabled. */
  readonly disabledReason?: string | undefined;
  /** Keep the control trailing on narrow screens instead of stacking it full width. */
  readonly inline?: boolean;
  readonly id?: string;
  readonly className?: string;
}

/** A settings line: what it is on the left, the control on the right; stacks under 480 px unless inline. */
export function SettingRow({
  title,
  description,
  control,
  configKey,
  disabledReason,
  inline = false,
  id,
  className,
}: SettingRowProps) {
  const disabled = disabledReason !== undefined;
  return (
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        "flex items-center gap-x-6 gap-y-2 border-b border-border py-3.5 last:border-b-0",
        inline ? "flex-nowrap" : "flex-wrap",
        className,
      )}
    >
      <div className={cn("min-w-0 flex-1", !inline && "min-w-[min(16rem,100%)]")}>
        <p id={id} className={cn("text-base", disabled ? "text-muted-foreground" : "text-foreground")}>
          {title}
        </p>
        {configKey === undefined ? null : <p className="mt-0.5 font-mono text-xs text-muted-foreground">{configKey}</p>}
        {description === undefined ? null : (
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{description}</p>
        )}
        {disabled ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <Ban aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="text-pretty">{disabledReason}</span>
          </p>
        ) : null}
      </div>
      <div
        inert={disabled || undefined}
        className={cn(
          "flex max-w-full shrink-0 items-center gap-2",
          disabled && "opacity-45",
          !inline && "max-sm:w-full max-sm:[&>*]:flex-1 sm:[&>*]:flex-none",
        )}
      >
        {control}
      </div>
    </div>
  );
}
