import type { Display } from "@doriface/protocol";

const HEX = /^#[0-9a-f]{6}$/i;

function colour(style: CSSStyleDeclaration, name: string): string | null {
  const value = style.getPropertyValue(name).trim().slice(0, 7);
  return HEX.test(value) ? value.toLowerCase() : null;
}

/** The viewer's colours as the core needs them to answer OSC 10/11/12 queries. */
export function readDisplay(element: HTMLElement): Display {
  const style = getComputedStyle(element);
  return { fg: colour(style, "--term-fg"), bg: colour(style, "--term-bg"), cursor: colour(style, "--term-cursor") };
}
