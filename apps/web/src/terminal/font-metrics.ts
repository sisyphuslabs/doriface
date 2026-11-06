/**
 * Ghostty rounds a face's advance and line height to device pixels. Measure the vertical font box at high resolution,
 * so small-size hinting cannot change its em ratio. A DOM probe supplies the browser's actual fractional advance;
 * spacing bridges that advance to the native cell grid without scaling the glyph itself.
 *
 * A view with no layout (its tab or space not shown) lays the probe out at no width: that is no measurement, and writing
 * it would make the cell 0 px and every wide glyph's fitted size 0 (#645). Such a view keeps what it had, and the
 * caller measures it again once it is laid out. Returns whether it measured.
 */
export function applyFontMetrics(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const context = element.ownerDocument.createElement("canvas").getContext("2d");
  if (context === null) return false;
  context.font = `1000px ${style.fontFamily}`;
  const metrics = context.measureText("W");
  const lineHeight = (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 1000;
  const probe = element.ownerDocument.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;width:auto;white-space:pre;letter-spacing:0";
  probe.textContent = "W";
  element.appendChild(probe);
  const advance = probe.getBoundingClientRect().width;
  probe.remove();
  if (!(advance > 0)) return false;
  const dpr = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  element.style.setProperty("--term-line-height", String(lineHeight));
  element.style.setProperty("--term-device-pixel", `${1 / dpr}px`);
  element.style.setProperty("--term-native-cell-width", `${Math.round(advance * dpr) / dpr}px`);
  element.style.setProperty("--term-native-spacing", `${Math.round(advance * dpr) / dpr - advance}px`);
  return true;
}
