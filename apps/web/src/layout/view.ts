import { isJsonObject } from "@doriface/protocol";

/**
 * What this screen looks at, kept out of the shared document as herdr-app keeps its `view.json` (`src/mirror.rs`
 * `View`): the selected tab and, per tab, the focused and zoomed pane. Keyed by tab key (`tabKey`), per core.
 */
export interface View {
  readonly active: string | null;
  readonly focused: Readonly<Record<string, string>>;
  readonly zoomed: Readonly<Record<string, string>>;
}

export const NO_VIEW: View = { active: null, focused: {}, zoomed: {} };

const storageKey = (core: string): string => `doriface.view.${core}`;

function strings(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
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
  };
}

export function saveView(core: string, view: View, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(storageKey(core), JSON.stringify(view));
  } catch {
    // A full or blocked storage only costs the next reload its focus; the layout itself is in the core.
  }
}

/** A tab's key: its id in the document, behind its machine's permanent id when it is not this core's. */
export const tabKey = (machineId: string | null, tabId: string): string =>
  machineId === null ? tabId : `${machineId}/${tabId}`;
