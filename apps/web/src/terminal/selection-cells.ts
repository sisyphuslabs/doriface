/** One painted run of selected cells in a row, in px within the grid. */
export interface CellRect {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly width: number;
}

const ROW = ".term-row";

/** The cell span (or link) that is a direct child of `row` and holds `node`, or null for the row itself. */
function cellOf(row: HTMLElement, node: Node): HTMLElement | null {
  let element: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  let child: HTMLElement | null = null;
  while (element !== null && element !== row) {
    if (element instanceof HTMLElement) {
      const parent: Node | null = element.parentNode;
      // A link holds spans of its own; the span inside it is the cell.
      if (parent === row || (parent instanceof HTMLElement && parent.classList.contains("term-link"))) {
        child = element;
        if (parent === row) break;
      }
    }
    element = element.parentNode;
  }
  return child;
}

function textBefore(cell: HTMLElement, node: Node, offset: number): number {
  if (node.nodeType !== Node.TEXT_NODE) {
    const children = [...node.childNodes].slice(0, offset);
    return children.reduce((sum, child) => sum + (child.textContent?.length ?? 0), 0);
  }
  const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let text = walker.nextNode(); text !== null && text !== node; text = walker.nextNode()) {
    count += text.textContent?.length ?? 0;
  }
  return count + offset;
}

/**
 * The column a DOM selection point falls on in `row`, counting from the row's left edge in cells. A wide span covers
 * its two cells and a non-ASCII span its one, so a point inside either lands before or after the whole cell; a run of
 * ASCII text has one character per cell, as wterm builds it.
 */
export function columnAt(row: HTMLElement, node: Node, offset: number, cell: number, cols: number): number {
  const target = cellOf(row, node);
  if (target === null) {
    const after = row.childNodes[offset];
    if (after === undefined) return cols;
    const at = after instanceof HTMLElement ? after : cellOf(row, after);
    return at === null ? 0 : columnAt(row, at, 0, cell, cols);
  }
  const rowBox = row.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  const start = Math.round((box.left - rowBox.left) / cell);
  const span = Math.max(1, Math.round(box.width / cell));
  const before = textBefore(target, node, offset);
  const length = target.textContent?.length ?? 0;
  // A run's text is one ASCII character per cell; any other span is one grapheme over its cells.
  const run = !target.classList.contains("term-wide") && length === span;
  const inside = run ? Math.min(before, span) : before > 0 ? span : 0;
  return Math.min(cols, Math.max(0, start + inside));
}

function rowsBetween(grid: HTMLElement, first: HTMLElement, last: HTMLElement): HTMLElement[] {
  const rows = [...grid.querySelectorAll<HTMLElement>(ROW)];
  const from = rows.indexOf(first);
  const to = rows.indexOf(last);
  return from === -1 || to === -1 ? [] : rows.slice(from, to + 1);
}

/**
 * The cells `range` selects in `grid`, one rect per row: from its start cell on its first row to its end cell on its
 * last, every cell in between, each the row's full height. A wide character is its two cells whatever font draws it,
 * as Ghostty paints a selection (#410). A range that starts or ends outside the grid takes the grid's first or last
 * row from its edge.
 */
export function selectedCells(range: Range, grid: HTMLElement, cell: number, cols: number): CellRect[] {
  if (range.collapsed || cell <= 0 || cols <= 0 || !range.intersectsNode(grid)) return [];
  const rows = [...grid.querySelectorAll<HTMLElement>(ROW)];
  const firstRow = rows[0];
  const lastRow = rows.at(-1);
  if (firstRow === undefined || lastRow === undefined) return [];
  const inGrid = (node: Node) => grid.contains(node);
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  const startRow = inGrid(startNode)
    ? (startNode instanceof HTMLElement ? startNode : startNode.parentElement)?.closest<HTMLElement>(ROW)
    : firstRow;
  const endRow = inGrid(endNode)
    ? (endNode instanceof HTMLElement ? endNode : endNode.parentElement)?.closest<HTMLElement>(ROW)
    : lastRow;
  if (startRow === null || startRow === undefined || endRow === null || endRow === undefined) return [];
  const startCol = inGrid(startNode) ? columnAt(startRow, startNode, range.startOffset, cell, cols) : 0;
  const endCol = inGrid(endNode) ? columnAt(endRow, endNode, range.endOffset, cell, cols) : cols;
  const rects: CellRect[] = [];
  for (const row of rowsBetween(grid, startRow, endRow)) {
    const from = row === startRow ? startCol : 0;
    const to = row === endRow ? endCol : cols;
    if (to > from) {
      rects.push({ top: row.offsetTop, height: row.offsetHeight, left: from * cell, width: (to - from) * cell });
    }
  }
  return rects;
}
