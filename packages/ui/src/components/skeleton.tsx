import { cn } from "../lib/cn.ts";

export interface SkeletonProps {
  readonly className?: string;
}

/** A placeholder shown at once while content loads; it carries no text and is hidden from assistive tech. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse rounded-sm bg-selected motion-reduce:animate-none", className)}
    />
  );
}
