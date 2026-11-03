import { Plus, X } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { Button } from "./button.tsx";
import { IconButton } from "./icon-button.tsx";

export interface FontFamilyListProps {
  /** Families in fallback order; the first is the primary face. */
  readonly families: readonly string[];
  /** Families the device does not have; they stay listed and say so. */
  readonly missing?: readonly string[];
  readonly onRemove?: (family: string) => void;
  readonly onAdd?: () => void;
  readonly className?: string;
}

/**
 * An ordered font stack, as Ghostty's repeated font-family key: each family by name and position, a missing family named as missing instead of silently skipped.
 */
export function FontFamilyList({ families, missing = [], onRemove, onAdd, className }: FontFamilyListProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <ol aria-label="Font families, in fallback order" className="flex flex-col rounded-md border border-input">
        {families.map((family, index) => {
          const absent = missing.includes(family);
          const repeat = families.slice(0, index).filter((entry) => entry === family).length;
          return (
            <li
              key={`${family}#${repeat}`}
              className="flex h-(--row) items-center gap-2 border-b border-border pr-1 pl-2 last:border-b-0"
            >
              <span data-numeric className="w-4 shrink-0 text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-sm",
                  absent ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {family}
              </span>
              {index === 0 ? <span className="shrink-0 text-xs text-muted-foreground">Primary</span> : null}
              {absent ? <span className="shrink-0 text-xs text-muted-foreground">Not installed</span> : null}
              {onRemove === undefined ? null : (
                <IconButton label={`Remove ${family}`} icon={<X />} onClick={() => onRemove(family)} />
              )}
            </li>
          );
        })}
      </ol>
      {onAdd === undefined ? null : (
        <Button variant="ghost" size="sm" onClick={onAdd} className="self-start">
          <Plus />
          Add fallback
        </Button>
      )}
    </div>
  );
}
