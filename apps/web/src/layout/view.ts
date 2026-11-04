import { isJsonObject } from "@doriface/protocol";

/**
 * What this screen looks at, kept out of the shared document as herdr-app keeps its `view.json` (`src/mirror.rs`
 * `View`): the selected tab and, per tab, the focused and zoomed pane. Keyed by tab key (`tabKey`), per core. `order` is
 * the tab strip's order as this screen arranged it; the strip mixes every machine's tabs, so no one document holds it.
 */
export interface View {
  readonly active: string | null;
  readonly focused: Readonly<Record<string, string>>;
  readonly zoomed: Readonly<Record<string, string>>;
  readonly order: readonly string[];
}

export const NO_VIEW: View = { active: null, focused: {}, zoomed: {}, order: [] };

const storageKey = (core: string): string => `doriface.view.${core}`;

function strings(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** The tab strip's order: a list of tab keys, each kept once. Anything else, a stray non-key included, is no order. */
function keys(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((key): key is string => typeof key === "string")) return [];
  return [...new Set(value)];
}

export function loadView(core: string, storage: Pick<Storage, "getItem"> = localStorage): View {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(storageKey(core)) ?? "null");
  } catch {
    return NO_VIEW;
  }
  if (!isJsonObject(parsed)) return NO_VIEW;
  const active = parsed["active"];
  return {
    active: typeof active === "string" ? active : null,
    focused: strings(parsed["focused"]),
    zoomed: strings(parsed["zoomed"]),
    order: keys(parsed["order"]),
  };
}

/**
 * Saves this screen's view; null once it is saved, else why the storage refused it (full or denied). A refusal never
 * throws: the view lives on in memory, and only the next reload loses the tab order and focus.
 */
export function saveView(core: string, view: View, storage: Pick<Storage, "setItem"> = localStorage): string | null {
  try {
    storage.setItem(storageKey(core), JSON.stringify(view));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A tab's key: its id in the document, behind its machine's permanent id when it is not this core's. */
export const tabKey = (machineId: string | null, tabId: string): string =>
  machineId === null ? tabId : `${machineId}/${tabId}`;
