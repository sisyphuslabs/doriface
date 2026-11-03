// Finds layout overflow on the rendered page. It runs inside the page, so it is one self-contained function.

/**
 * spill: a child or text runs past a box that lets it show. clipped: a box cuts its content off with no ellipsis.
 * untitled: text ends in an ellipsis with no title to read the rest. viewport: a fixed box or the page runs past the
 * window. Each finding names the box and its text.
 */
export interface Overflow {
  readonly rule: "spill" | "clipped" | "untitled" | "viewport";
  readonly at: string;
  readonly text: string;
  readonly px: number;
}

/** Every overflow outside the subtrees `skip` names. Pseudo-elements (hit areas) never count: only boxes and text do. */
export function findOverflows(skip: readonly string[]): Overflow[] {
  const found: Overflow[] = [];
  const slack = 1;
  const width = document.documentElement.clientWidth;
  const report = (rule: Overflow["rule"], el: Element, px: number): void => {
    const parts: string[] = [];
    for (let node: Element | null = el; node !== null && parts.length < 4; node = node.parentElement) {
      const name = node.getAttribute("aria-label") ?? node.getAttribute("data-slot") ?? node.getAttribute("role");
      parts.unshift(`${node.tagName.toLowerCase()}${name === null ? "" : `[${name.slice(0, 40)}]`}`);
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    found.push({ rule, at: parts.join(" > "), text, px: Math.round(px) });
  };
  const scrolling = new Set(["auto", "scroll"]);

  const elements = [...document.body.querySelectorAll("*")].filter(
    (el) => !skip.some((selector) => el.closest(selector) !== null) && el.checkVisibility({ visibilityProperty: true }),
  );
  for (const el of elements) {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.position === "fixed" && (box.left < -slack || box.right > width + slack)) {
      report("viewport", el, Math.max(-box.left, box.right - width));
    }
    const inline = style.display.startsWith("inline") && style.display !== "inline-block";
    if (inline || el.tagName === "svg" || el.closest("svg") !== null) continue;
    const inner = {
      left: box.left + el.clientLeft,
      right: box.left + el.clientLeft + el.clientWidth,
      top: box.top + el.clientTop,
      bottom: box.top + el.clientTop + el.clientHeight,
    };
    let x = 0;
    let y = 0;
    const measure = (rect: DOMRect): void => {
      if (rect.width === 0 && rect.height === 0) return;
      x = Math.max(x, inner.left - rect.left, rect.right - inner.right);
      y = Math.max(y, inner.top - rect.top, rect.bottom - inner.bottom);
    };
    for (const child of el.childNodes) {
      if (child instanceof Element) {
        if (!child.checkVisibility({ visibilityProperty: true })) continue;
        const position = getComputedStyle(child).position;
        if (position === "fixed" || (child.clientWidth <= 1 && child.clientHeight <= 1)) continue;
        measure(child.getBoundingClientRect());
      } else if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") {
        const range = document.createRange();
        range.selectNodeContents(child);
        // A text box is the font's whole ascent and descent; glyphs sit in its em box, which `leading-none` fits.
        const em = Number.parseFloat(style.fontSize);
        for (const rect of range.getClientRects()) {
          const inset = Math.max(0, (rect.height - em) / 2);
          measure(new DOMRect(rect.x, rect.y + inset, rect.width, rect.height - 2 * inset));
        }
      }
    }
    // An ellipsis draws only in a block container; a flex or grid box with text-overflow just cuts the text.
    const ellipsis = style.textOverflow === "ellipsis" && !/flex|grid/.test(style.display);
    const truncated = ellipsis && el.scrollWidth > el.clientWidth + slack;
    if (truncated && el.closest("[title]") === null) report("untitled", el, el.scrollWidth - el.clientWidth);
    const overX = x > slack && !scrolling.has(style.overflowX);
    const overY = y > slack && !scrolling.has(style.overflowY);
    if (overX && style.overflowX === "visible") report("spill", el, x);
    else if (overX && !truncated) report("clipped", el, x);
    if (overY && style.overflowY === "visible") report("spill", el, y);
    else if (overY) report("clipped", el, y);
  }
  const page = document.scrollingElement ?? document.documentElement;
  if (page.scrollWidth > width + slack) report("viewport", document.body, page.scrollWidth - width);
  return found;
}
