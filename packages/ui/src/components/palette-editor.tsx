import { cn } from "../lib/cn.ts";
import { ColorSwatch } from "./color-swatch.tsx";

export interface PaletteEditorProps {
  /** The 16 terminal colours, ansi0..ansi15, as #rrggbb. */
  readonly colors: readonly string[];
  /** Index of the colour being edited. */
  readonly selected?: number;
  readonly onSelect: (index: number) => void;
  /** Print each colour's value under its index; off when colours are CSS variables. */
  readonly showValues?: boolean;
  readonly className?: string;
}

/** The 16-colour terminal palette as two rows of eight: normal (0-7) over bright (8-15). Four per row on phones. */
export function PaletteEditor({ colors, selected, onSelect, showValues = true, className }: PaletteEditorProps) {
  return (
    <div role="group" aria-label="Terminal palette" className={cn("grid grid-cols-4 gap-1 sm:grid-cols-8", className)}>
      {colors.map((color, index) => (
        <ColorSwatch
          key={index}
          color={color}
          label={`${index}`}
          {...(showValues ? { value: color } : {})}
          selected={index === selected}
          aria-label={showValues ? `palette ${index}, ${color}` : `palette ${index}`}
          onClick={() => onSelect(index)}
        />
      ))}
    </div>
  );
}
