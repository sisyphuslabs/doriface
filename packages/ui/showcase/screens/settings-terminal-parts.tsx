import { FileUp, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  BUILTIN_PALETTES,
  Button,
  ColorSwatch,
  Input,
  Switch,
  TerminalPreview,
  resolveTheme,
} from "../../src/index.ts";
import { CLAUDE_LINES } from "../data.ts";

/** The terminal colours of the theme on screen, so swatch values match the preview beside them. */
export function terminalColors(): {
  readonly ansi: readonly string[];
  readonly cursor: string;
  readonly selection: string;
} {
  const pinned = document.documentElement.dataset["theme"];
  const system = matchMedia("(prefers-color-scheme: dark)").matches ? BUILTIN_PALETTES.night : BUILTIN_PALETTES.day;
  const palette = Object.entries(BUILTIN_PALETTES).find(([name]) => name === pinned)?.[1] ?? system;
  const theme = resolveTheme(palette);
  return { ansi: theme.ansi, cursor: theme.roles.cursor, selection: theme.roles.selection };
}

/** A font stack the mockups can edit: remove drops a family, add appends the next fallback not yet listed. */
export function useFontStack(initial: readonly string[]) {
  const [families, setFamilies] = useState(initial);
  const next = ["Menlo", "SF Mono", "Apple Color Emoji"].find((family) => !families.includes(family));
  return {
    families,
    onRemove: (family: string) => setFamilies(families.filter((entry) => entry !== family)),
    ...(next === undefined ? {} : { onAdd: () => setFamilies([...families, next]) }),
  };
}

export function Toggle({
  label,
  on,
  disabled = false,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly disabled?: boolean;
}) {
  return <Switch aria-label={label} defaultChecked={on} disabled={disabled} />;
}

export function Mono({
  label,
  value,
  width = "sm:w-40",
}: {
  readonly label: string;
  readonly value: string;
  readonly width?: string;
}) {
  return <Input aria-label={label} mono defaultValue={value} className={`w-full ${width}`} />;
}

export function Swatch({ label, color }: { readonly label: string; readonly color: string }) {
  return <ColorSwatch color={color} label={label} value={color} className="w-28" />;
}

export function Header() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-lg font-semibold text-foreground">Terminal</h2>
        <Button size="sm">
          <FileUp />
          Import Ghostty config…
        </Button>
      </div>
      <p className="text-sm text-pretty text-muted-foreground">
        Every setting uses Ghostty's key name and values, so a Ghostty config imports as is.
      </p>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input aria-label="Search terminal settings" placeholder="Search settings or Ghostty keys" className="pl-8" />
      </div>
      <figure className="flex flex-col gap-1.5">
        <figcaption className="text-xs font-medium text-muted-foreground">Preview</figcaption>
        <TerminalPreview
          lines={CLAUDE_LINES.slice(0, 4)}
          cursor
          label="Terminal preview with the settings below"
          className="rounded-lg border border-border"
        />
      </figure>
    </div>
  );
}

export function Rows({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

/** Ghostty's paired theme value, one field per appearance. */
export function ThemePair({ light, dark }: { readonly light: string; readonly dark: string }) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-64">
      {[
        { side: "light", value: light },
        { side: "dark", value: dark },
      ].map((entry) => (
        <label key={entry.side} className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="w-9 shrink-0">{entry.side}</span>
          <Input aria-label={`Theme for ${entry.side} appearance`} mono defaultValue={entry.value} />
        </label>
      ))}
    </div>
  );
}
