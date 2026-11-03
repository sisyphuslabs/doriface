/**
 * Roving focus over the sidebar lists: every `section` is one list and one Tab stop. A row is a button that is a
 * direct child of the section, or the first button of a direct child (a machine row); the other buttons of that child
 * are the row's actions, reached with the arrow keys instead of Tab.
 */
const STOP = "data-roving-stop";

const isButton = (node: unknown): node is HTMLButtonElement => node instanceof HTMLButtonElement;

function rowOf(child: Element): HTMLButtonElement | undefined {
  if (isButton(child)) return child;
  const first = child.firstElementChild;
  return child.tagName === "DIV" && isButton(first) ? first : undefined;
}

export function rowsOf(section: Element): HTMLButtonElement[] {
  return [...section.children].flatMap((child) => rowOf(child) ?? []);
}

function actionsOf(row: HTMLButtonElement): HTMLButtonElement[] {
  const parent = row.parentElement;
  if (parent === null || parent.tagName === "SECTION") return [];
  return [...parent.querySelectorAll("button")].filter((button) => button !== row);
}

const usable = (rows: readonly HTMLButtonElement[]): HTMLButtonElement[] => rows.filter((row) => !row.disabled);

/** Keeps one row per list in the Tab order: the last one focused, else the selected one, else the first. */
export function syncStops(root: Element): void {
  for (const section of root.querySelectorAll("section")) {
    const rows = rowsOf(section);
    const enabled = usable(rows);
    const stop =
      enabled.find((row) => row.hasAttribute(STOP)) ??
      enabled.find((row) => row.getAttribute("aria-current") === "true") ??
      enabled[0];
    for (const row of rows) {
      row.tabIndex = row === stop ? 0 : -1;
      row.toggleAttribute(STOP, row === stop);
      for (const action of actionsOf(row)) action.tabIndex = -1;
    }
  }
}

export function rememberStop(target: EventTarget | null): void {
  if (!isButton(target)) return;
  const section = target.closest("section");
  if (section === null || !rowsOf(section).includes(target)) return;
  for (const row of rowsOf(section)) {
    row.tabIndex = row === target ? 0 : -1;
    row.toggleAttribute(STOP, row === target);
  }
}

function neighbourRow(root: Element, row: HTMLButtonElement, step: 1 | -1): HTMLButtonElement | undefined {
  const all = [...root.querySelectorAll("section")].flatMap((section) => usable(rowsOf(section)));
  return all[all.indexOf(row) + step];
}

function ownRow(target: HTMLButtonElement): HTMLButtonElement | undefined {
  const first = target.parentElement?.firstElementChild;
  return isButton(first) && first !== target && actionsOf(first).includes(target) ? first : undefined;
}

/** The element an unmodified arrow, Home or End key moves focus to, or undefined when the key is not ours. */
export function rovingTarget(root: Element, target: EventTarget | null, key: string): HTMLButtonElement | undefined {
  if (!isButton(target)) return undefined;
  const section = target.closest("section");
  if (section === null || !root.contains(section)) return undefined;
  const owner = ownRow(target);
  if (owner !== undefined) return key === "ArrowLeft" ? owner : undefined;
  const rows = usable(rowsOf(section));
  if (!rows.includes(target)) return undefined;
  switch (key) {
    case "ArrowDown":
      return neighbourRow(root, target, 1);
    case "ArrowUp":
      return neighbourRow(root, target, -1);
    case "Home":
      return rows[0];
    case "End":
      return rows.at(-1);
    case "ArrowRight":
      return actionsOf(target).find((action) => !action.disabled);
    default:
      return undefined;
  }
}
