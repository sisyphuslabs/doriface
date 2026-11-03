/** A 24-bit sRGB colour as 0xrrggbb. */
export type Rgb = number;

/** A colour that may carry alpha: [rgb, alpha 0..1]. */
export interface Rgba {
  readonly rgb: Rgb;
  readonly alpha: number;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX8 = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i;

export function parseRgb(value: string): Rgb | undefined {
  const match = HEX6.exec(value.trim());
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 16);
}

export function parseRgba(value: string): Rgba | undefined {
  const rgb = parseRgb(value);
  if (rgb !== undefined) return { rgb, alpha: 1 };
  const match = HEX8.exec(value.trim());
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { rgb: Number.parseInt(match[1], 16), alpha: Number.parseInt(match[2], 16) / 255 };
}

export function hex(rgb: Rgb): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

function channel(rgb: Rgb, shift: number): number {
  return (rgb >> shift) & 255;
}

/** herdr-app's `mix`: per-channel linear blend in sRGB, rounded. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const value = Math.round(channel(a, shift) * (1 - t) + channel(b, shift) * t);
    out |= value << shift;
  }
  return out;
}

/** herdr-app's light test: Rec. 709 weights over gamma-encoded channels. */
export function isLight(rgb: Rgb): boolean {
  return (0.2126 * channel(rgb, 16) + 0.7152 * channel(rgb, 8) + 0.0722 * channel(rgb, 0)) / 255 > 0.5;
}

function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance. */
export function luminance(rgb: Rgb): number {
  return 0.2126 * linear(channel(rgb, 16)) + 0.7152 * linear(channel(rgb, 8)) + 0.0722 * linear(channel(rgb, 0));
}

/** WCAG 2.2 contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Flattens a translucent colour over an opaque backdrop. */
export function over(top: Rgba, backdrop: Rgb): Rgb {
  return mix(backdrop, top.rgb, top.alpha);
}
