/**
 * Ghostty rounds a face's advance and line height to device pixels. Measure the vertical font box at high resolution,
 * so small-size hinting cannot change its em ratio. A DOM probe supplies the browser's actual fractional advance;
 * spacing bridges that advance to the native cell grid without scaling the glyph itself.
 */
export function applyFontMetrics(element: HTMLElement): void {
  const style = getComputedStyle(element);
  const context = element.ownerDocument.createElement("canvas").getContext("2d");
  if (context === null) return;
  context.font = `1000px ${style.fontFamily}`;
  const metrics = context.measureText("W");
  const lineHeight = (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 1000;
  const probe = element.ownerDocument.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;width:auto;white-space:pre;letter-spacing:0";
  probe.textContent = "W";
  element.appendChild(probe);
  const advance = probe.getBoundingClientRect().width;
  probe.remove();
  const dpr = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  element.style.setProperty("--term-line-height", String(lineHeight));
  element.style.setProperty("--term-device-pixel", `${1 / dpr}px`);
  element.style.setProperty("--term-native-cell-width", `${Math.round(advance * dpr) / dpr}px`);
  element.style.setProperty("--term-native-spacing", `${Math.round(advance * dpr) / dpr - advance}px`);
}
