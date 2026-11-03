import { contrast, hex, mix, over, parseRgba, type Rgb } from "./color.ts";

export const AA_TEXT = 4.5;
export const AA_GRAPHIC = 3;

/** Flattens a role value (which may be translucent) over an opaque surface. */
export function flatten(value: string, surface: Rgb): Rgb {
  const parsed = parseRgba(value);
  if (parsed === undefined) throw new TypeError(`${value} is not a colour`);
  return over(parsed, surface);
}

/** The lowest contrast a colour reaches across every surface it is drawn on. */
export function worstContrast(value: string, surfaces: readonly Rgb[]): number {
  return Math.min(...surfaces.map((surface) => contrast(flatten(value, surface), surface)));
}

/**
 * Moves a colour toward `ink` in 1% steps until it reaches `minimum` against every surface.
 * Values that already pass come back unchanged, so herdr-app's own colours survive where they can.
 */
export function ensureContrast(value: string, surfaces: readonly Rgb[], minimum: number, ink: Rgb): string {
  if (worstContrast(value, surfaces) >= minimum) return value;
  const start = flatten(value, surfaces[0] ?? ink);
  for (let step = 1; step <= 100; step += 1) {
    const candidate = hex(mix(start, ink, step / 100));
    if (worstContrast(candidate, surfaces) >= minimum) return candidate;
  }
  return hex(ink);
}
