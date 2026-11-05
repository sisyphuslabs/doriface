import { cn, Spinner } from "@doriface/ui";
import { useEffect, useState } from "react";

/** How long a wait goes unremarked: a quick answer never flashes a busy state (HIG: show progress only once it lasts). */
export const QUIET_BUSY_DELAY_MS = 400;

/**
 * A wait that says what it waits for, quietly: nothing for the first QUIET_BUSY_DELAY_MS, then a spinner and a short
 * line. It is a status from the start, so assistive tech hears the label at once while sighted users see nothing for a
 * quick answer. The parent places it; it takes no room the content would otherwise have (no layout shift).
 */
export function QuietBusy({ label, text, className }: { label: string; text: string; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), QUIET_BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "pointer-events-none flex items-center justify-center gap-2 text-xs text-muted-foreground transition-opacity",
        shown ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <Spinner />
      <span>{text}</span>
    </div>
  );
}
