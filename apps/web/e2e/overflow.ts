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
  // Marks reach past the em box by how much depends on the mark and the font: 0.07-0.13 em for the ring on Å, 0.16-0.28
  // em for stacked Vietnamese marks (Ẫ, Ǻ) and Thai tone marks (Chromium TextMetrics, centred em box). So a word that
  // carries a mark is measured by its own ink as well. Unmarked glyphs sit in the em box, which a status badge's "!"
  // fills exactly, so they keep it.
  const marked = /\p{M}/u;
  const pen = document.createElement("canvas").getContext("2d");
  if (pen === null) throw new Error("the overflow check needs a 2D canvas to measure ink");
  // A title helps only the text it carries: the truncating element's own, or its control's when that names the text.
  const control = 'button, a[href], label, summary, [role="button"], [role="link"], [role="tab"], [role="option"]';
  const titled = (el: Element): boolean => {
    const title = el.parentElement?.closest(control)?.getAttribute("title");
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return (el.getAttribute("title") ?? "") !== "" || (title != null && text !== "" && title.includes(text));
  };
  // Replaced elements are atoms even when inline: they are measured by their box, never through their children.
  const replaced = /^(IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT)$/;
  const flows = (el: Element): boolean =>
    el instanceof HTMLElement && getComputedStyle(el).display === "inline" && !replaced.test(el.tagName);

  const elements = [...document.body.querySelectorAll("*")].filter(
    (el) => !skip.some((selector) => el.closest(selector) !== null) && el.checkVisibility({ visibilityProperty: true }),
  );
  for (const el of elements) {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.position === "fixed" && (box.left < -slack || box.right > width + slack)) {
      report("viewport", el, Math.max(-box.left, box.right - width));
    }
    if (flows(el) || el.tagName === "svg" || el.closest("svg") !== null) continue;
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
    // A text or inline box is the font's whole ascent and descent; glyphs sit in its em box, and marks in their ink.
    const glyphs = (rect: DOMRect, of: Element, text: string): DOMRect => {
      const font = getComputedStyle(of);
      const inset = Math.max(0, (rect.height - Number.parseFloat(font.fontSize)) / 2);
      let top = rect.top + inset;
      let bottom = rect.bottom - inset;
      if (marked.test(text.normalize("NFD"))) {
        pen.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
        const metrics = pen.measureText(text);
        const baseline = rect.top + metrics.fontBoundingBoxAscent;
        top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
        bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
      }
      return new DOMRect(rect.x, top, rect.width, bottom - top);
    };
    // Each word's line fragments: the spaces a line wraps at hang past the box without being drawn.
    const inked = (text: Text): DOMRect[] =>
      [...text.data.matchAll(/\S+/g)].flatMap((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return [...range.getClientRects()].map((rect) => glyphs(rect, text.parentElement ?? el, word[0]));
      });
    // Content in the box's own lines: text by its words, an inline element by each line fragment that holds a word
    // (a fragment of nothing but spaces draws nothing), and every other box whole.
    const flow = (node: ChildNode): void => {
      if (node instanceof Text) {
        for (const rect of inked(node)) measure(rect);
        return;
      }
      if (!(node instanceof Element) || !node.checkVisibility({ visibilityProperty: true })) return;
      if (getComputedStyle(node).position === "fixed") return;
      if (!flows(node)) {
        if (node.clientWidth > 1 || node.clientHeight > 1) measure(node.getBoundingClientRect());
        return;
      }
      const wordRects: DOMRect[] = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        if (text instanceof Text) wordRects.push(...inked(text));
      }
      for (const fragment of node.getClientRects()) {
        const holds = wordRects.some(
          (word) =>
            word.right > fragment.left &&
            word.left < fragment.right &&
            word.bottom > fragment.top &&
            word.top < fragment.bottom,
        );
        if (holds) measure(glyphs(fragment, node, node.textContent ?? ""));
      }
      for (const child of node.childNodes) flow(child);
    };
    for (const child of el.childNodes) flow(child);
    // An ellipsis draws only in a block container; a flex or grid box with text-overflow just cuts the text.
    const ellipsis = style.textOverflow === "ellipsis" && !/flex|grid/.test(style.display);
    const truncated = ellipsis && el.scrollWidth > el.clientWidth + slack;
    if (truncated && !titled(el)) report("untitled", el, el.scrollWidth - el.clientWidth);
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
