import { parseRgb, parseRgba, type Rgb } from "./color.ts";

/** The 26 semantic roles herdr-app resolves, in its order. */
export const SEMANTIC_ROLES = [
  "background",
  "terminal_foreground",
  "foreground",
  "surface",
  "canvas",
  "chrome",
  "popover",
  "raised",
  "hover",
  "selected",
  "border",
  "input",
  "muted",
  "dim",
  "accent",
  "accent_foreground",
  "solid",
  "solid_foreground",
  "ring",
  "selection",
  "cursor",
  "working",
  "blocked",
  "done",
  "idle",
  "unknown",
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/** A terminal palette: the only input a theme needs. */
export interface Palette {
  readonly background: Rgb;
  readonly foreground: Rgb;
  readonly selection: Rgb;
  readonly cursor?: Rgb;
  /** ansi0..ansi15. */
  readonly ansi: readonly Rgb[];
  /** working, blocked, done. Theme files leave it out and fall back to ansi3/1/4. */
  readonly status?: readonly [Rgb, Rgb, Rgb];
}

/** A herdr-app `themes/<name>.json` file, parsed: a palette plus overrides. */
export interface ThemeSource {
  readonly palette: Palette;
  readonly overrides: Readonly<Record<string, string>>;
}

export class ThemeFileError extends Error {
  override readonly name = "ThemeFileError";
}

const FILE_KEYS = new Set(["background", "foreground", "selection", "cursor", "ansi", "colors"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rgbField(key: string, value: unknown): Rgb {
  const rgb = typeof value === "string" ? parseRgb(value) : undefined;
  if (rgb === undefined) throw new ThemeFileError(`${key} ${JSON.stringify(value)} is not #rrggbb`);
  return rgb;
}

/**
 * Parses a herdr-app theme file with the same rules as herdr-app: unknown keys,
 * a wrong ANSI count, or a malformed colour are errors, never silently dropped.
 */
export function parseThemeFile(json: unknown): ThemeSource {
  if (!isRecord(json)) throw new ThemeFileError("a theme file is a JSON object");
  for (const key of Object.keys(json)) {
    if (!FILE_KEYS.has(key)) throw new ThemeFileError(`unknown field ${JSON.stringify(key)}`);
  }
  const ansiValue = json["ansi"];
  if (!Array.isArray(ansiValue) || ansiValue.length !== 16) throw new ThemeFileError("ansi must list 16 colours");
  const ansi = ansiValue.map((value, index) => rgbField(`ansi[${index}]`, value));
  const colors = json["colors"] ?? {};
  if (!isRecord(colors)) throw new ThemeFileError("colors must be an object");
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== "string" || parseRgba(value) === undefined) {
      throw new ThemeFileError(`colors.${key}: ${JSON.stringify(value)} is not #rrggbb or #rrggbbaa`);
    }
    overrides[key] = value;
  }
  const cursorValue = json["cursor"];
  const base = {
    background: rgbField("background", json["background"]),
    foreground: rgbField("foreground", json["foreground"]),
    selection: rgbField("selection", json["selection"]),
    ansi,
  };
  const palette: Palette =
    cursorValue === undefined || cursorValue === null ? base : { ...base, cursor: rgbField("cursor", cursorValue) };
  return { palette, overrides };
}
