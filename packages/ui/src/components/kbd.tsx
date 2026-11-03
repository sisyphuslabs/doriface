import { cn } from "../lib/cn.ts";

export interface KbdProps {
  /** One entry per key, e.g. ["⌘", "⇧", "P"]. */
  readonly keys: readonly string[];
  /** Keep the chips on touch layouts too, where a value (a binding) rather than a hint is shown. */
  readonly persistent?: boolean;
  readonly className?: string;
}

/** Keyboard shortcut chips. They are hints, so touch layouts hide them unless `persistent`. */
export function Kbd({ keys, persistent = false, className }: KbdProps) {
  return (
    <kbd className={cn("inline-flex items-center gap-0.5 font-sans", !persistent && "coarse:hidden", className)}>
      {keys.map((key) => (
        <span
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border bg-raised px-1 font-sans text-2xs text-muted-foreground"
        >
          {key}
        </span>
      ))}
    </kbd>
  );
}
