import type { ReactNode } from "react";
import { cn } from "../../src/index.ts";

/**
 * A phone-sized viewport drawn on the desktop board, so phone screens can be reviewed beside each other.
 * It uses the coarse-pointer density and an iPhone 14's safe areas, and draws the home indicator.
 */
export function PhoneFrame({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <div
        data-density="coarse"
        data-insets="phone"
        className="relative h-[844px] w-[390px] overflow-hidden rounded-[2.5rem] border border-border bg-background text-base shadow-overlay"
      >
        {children}
        <span
          aria-hidden
          className="absolute bottom-2 left-1/2 h-1.5 w-32 -translate-x-1/2 rounded-full bg-foreground/80"
        />
      </div>
      <figcaption className="text-sm text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** One step of a flow on a review board. On phones the board is the step itself. */
export function BoardFrame({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section aria-label={label} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <p className="hidden text-sm text-muted-foreground lg:block">{label}</p>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface lg:rounded-xl lg:border lg:border-border">
        {children}
      </div>
    </section>
  );
}
