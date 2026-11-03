import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";
import { cn } from "../lib/cn.ts";
import type { ResolvedTheme } from "../theme/resolve.ts";

export interface ThemeOption {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly theme: ResolvedTheme;
}

export interface ThemePickerProps {
  readonly options: readonly ThemeOption[];
  readonly value: string;
  readonly onValueChange?: (id: string) => void;
  readonly className?: string;
}

/** Theme swatches drawn from each theme's own colours. Selection is a wash plus a check, not a coloured ring. */
export function ThemePicker({ options, value, onValueChange, className }: ThemePickerProps) {
  return (
    <RadioGroup
      aria-label="Theme"
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next);
      }}
      className={cn("grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2", className)}
    >
      {options.map((option) => {
        const r = option.theme.roles;
        return (
          <Radio.Root
            key={option.id}
            value={option.id}
            className={cn(
              "group flex flex-col gap-2 rounded-lg border border-border p-2 text-left outline-none",
              "hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring data-checked:bg-selected",
            )}
          >
            <span
              aria-hidden
              className="flex h-14 overflow-hidden rounded-md border border-border"
              style={{ background: r.chrome }}
            >
              <span className="w-1/3" style={{ background: r.chrome }} />
              <span className="flex flex-1 flex-col justify-center gap-1 px-2" style={{ background: r.background }}>
                {[r.accent, r.working, r.blocked, r.done].map((color) => (
                  <span key={color} className="h-1 rounded-full" style={{ background: color, width: "70%" }} />
                ))}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{option.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{option.source}</span>
              </span>
              <Radio.Indicator className="flex size-4 items-center justify-center text-foreground">
                <Check className="size-3.5" />
              </Radio.Indicator>
            </span>
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
