import { hex, isLight, mix, type Rgb } from "./color.ts";
import { SEMANTIC_ROLES, type Palette, type SemanticRole, type ThemeSource } from "./palette.ts";

/** A resolved theme. Colours are `#rrggbb` or `#rrggbbaa`. */
export interface ResolvedTheme {
  readonly light: boolean;
  readonly roles: Readonly<Record<SemanticRole, string>>;
  /** ansi0..ansi15. */
  readonly ansi: readonly string[];
  /** Override keys that name no built-in role; herdr-app keeps them for mods. */
  readonly extra: Readonly<Record<string, string>>;
}

const ANSI_KEY = /^ansi(\d{1,2})$/;

function isSemanticRole(key: string): key is SemanticRole {
  return SEMANTIC_ROLES.some((role) => role === key);
}

const LIGHT_INK = 0x1b1b1e;
const DARK_INK = 0xeeeeef;
const WARM_GREY = 0xe8e8e2;

function ansiAt(palette: Palette, index: number): Rgb {
  const value = palette.ansi[index];
  if (value === undefined) throw new RangeError(`palette has no ansi${index}`);
  return value;
}

/**
 * A TypeScript port of herdr-app's `resolve()` (settings.rs): one terminal palette
 * becomes the 26 chrome roles plus ansi0..15, so any herdr-app theme imports unchanged.
 */
export function resolveTheme(source: Palette | ThemeSource): ResolvedTheme {
  const palette = "palette" in source ? source.palette : source;
  const overrides = "palette" in source ? source.overrides : {};
  const bg = palette.background;
  const light = isLight(bg);
  const fg = light ? LIGHT_INK : DARK_INK;
  const [working, blocked, done] = palette.status ?? [ansiAt(palette, 3), ansiAt(palette, 1), ansiAt(palette, 4)];
  const tone = light
    ? {
        popover: hex(bg),
        raised: hex(mix(bg, 0, 0.035)),
        hover: "#0000000c",
        selected: "#00000012",
        border: "#00000017",
        input: "#00000026",
        canvas: mix(bg, WARM_GREY, 0.2),
        chrome: mix(bg, WARM_GREY, 0.6),
      }
    : {
        popover: hex(mix(bg, 0xffffff, 0.06)),
        raised: hex(mix(bg, 0xffffff, 0.09)),
        hover: "#ffffff0e",
        selected: "#ffffff17",
        border: "#ffffff18",
        input: "#ffffff24",
        canvas: mix(bg, 0, 0.16),
        chrome: mix(bg, 0, 0.32),
      };
  const roles: Record<SemanticRole, string> = {
    background: hex(bg),
    terminal_foreground: hex(palette.foreground),
    foreground: hex(fg),
    surface: hex(bg),
    canvas: hex(tone.canvas),
    chrome: hex(tone.chrome),
    popover: tone.popover,
    raised: tone.raised,
    hover: tone.hover,
    selected: tone.selected,
    border: tone.border,
    input: tone.input,
    muted: hex(mix(bg, fg, light ? 0.66 : 0.6)),
    dim: hex(mix(bg, fg, light ? 0.46 : 0.38)),
    accent: hex(ansiAt(palette, 4)),
    accent_foreground: hex(bg),
    solid: hex(fg),
    solid_foreground: hex(light ? 0xffffff : mix(bg, 0, 0.28)),
    ring: hex(mix(bg, fg, 0.7)),
    selection: hex(palette.selection),
    cursor: hex(palette.cursor ?? palette.foreground),
    working: hex(working),
    blocked: hex(blocked),
    done: hex(done),
    idle: hex(mix(bg, fg, 0.38)),
    unknown: hex(mix(bg, fg, 0.38)),
  };
  const ansi = palette.ansi.map((value) => hex(value));
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const ansiIndex = ANSI_KEY.exec(key)?.[1];
    if (isSemanticRole(key)) roles[key] = value;
    else if (ansiIndex !== undefined && Number(ansiIndex) < ansi.length) ansi[Number(ansiIndex)] = value;
    else extra[key] = value;
  }
  return { light, roles, ansi, extra };
}
