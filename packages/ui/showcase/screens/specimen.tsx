import type { ReactNode } from "react";
import { cn } from "../../src/index.ts";

export function Section({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 border-t border-border pt-5", className)}>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** A labelled cell: the state name under the primitive rendered in that state. */
export function Cell({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      {children}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function Row({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cn("flex flex-wrap items-start gap-x-6 gap-y-4", className)}>{children}</div>;
}

export const FORCED = [
  { label: "default", force: undefined },
  { label: "hover", force: "hover" },
  { label: "pressed", force: "active" },
  { label: "focus-visible", force: "focus" },
] as const;
