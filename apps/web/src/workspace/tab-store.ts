import { type KeyedTabs, NO_TABS } from "./tab-follow.ts";

/** Open tabs per core, in strip order, beside the other local settings (doriface.layout, doriface.appearance). */
export const TABS_KEY = "doriface.tabs";

function readAll(storage: Pick<Storage, "getItem">): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(TABS_KEY) ?? "null");
  } catch {
    return {};
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

const keyOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The tabs a core had open when the page last saved them: their order, the active tab and the split. A tab whose
 * terminal is gone drops when followTerminals first sees the feed, so a stale entry costs nothing. Anything unreadable
 * reads as no tabs.
 */
export function loadTabs(core: string, storage: Pick<Storage, "getItem"> = localStorage): KeyedTabs {
  const entry: unknown = readAll(storage)[core];
  if (typeof entry !== "object" || entry === null) return NO_TABS;
  const rawOpen: unknown = Reflect.get(entry, "open");
  const open = Array.isArray(rawOpen) ? [...new Set(rawOpen.filter((key) => typeof key === "string"))] : [];
  const listed = (key: string | null): string | null => (key !== null && open.includes(key) ? key : null);
  const active = listed(keyOrNull(Reflect.get(entry, "active"))) ?? open[0] ?? null;
  const split = listed(keyOrNull(Reflect.get(entry, "split")));
  return { ...NO_TABS, open, active, split: split === active ? null : split };
}

/**
 * Saves one core's tabs, leaving every other core's as they were. Storage that is full or denied is reported and the
 * tabs live on in memory, so a refused write never takes the workspace down.
 */
export function saveTabs(
  core: string,
  tabs: KeyedTabs,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const all = { ...readAll(storage), [core]: { open: tabs.open, active: tabs.active, split: tabs.split } };
  try {
    storage.setItem(TABS_KEY, JSON.stringify(all));
  } catch (error) {
    console.error(`save the tab order: ${String(error)}`);
  }
}
