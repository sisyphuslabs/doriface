import { cn } from "../lib/cn.ts";

export interface FingerprintProps {
  /** Hex digits; shown in groups of four for reading aloud. */
  readonly value: string;
  readonly label: string;
  /** Group indexes that differ from the expected value. */
  readonly mismatched?: readonly number[];
  readonly className?: string;
}

/** A key fingerprint laid out for side-by-side comparison. Mismatched groups are struck and bold, not only red. */
export function Fingerprint({ value, label, mismatched = [], className }: FingerprintProps) {
  const groups = value.toUpperCase().match(/.{1,4}/g) ?? [];
  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      <p className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-sm tracking-wider text-foreground">
        {groups.map((group, index) => {
          const bad = mismatched.includes(index);
          return (
            <span
              key={`${index}-${group}`}
              className={cn(bad && "font-bold text-destructive line-through decoration-2")}
              aria-label={bad ? `${group}, differs` : undefined}
            >
              {group}
            </span>
          );
        })}
      </p>
    </figure>
  );
}
