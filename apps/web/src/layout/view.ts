import { isJsonObject } from "@doriface/protocol";

/**
 * What this screen looks at, kept out of the shared document as herdr-app keeps its `view.json` (`src/mirror.rs`
 * `View`): the selected tab, the tab each space last showed (`spaces`, keyed by `spaceKey`) so picking a space brings its
 * tab back, and per tab the focused and zoomed pane. Tabs are keyed by tab key (`tabKey`), per core. The tabs' order is
 * the documents' own, so every device shows it the same.
 */
export interface View {
  readonly active: string | null;
  readonly focused: Readonly<Record<string, string>>;
  readonly zoomed: Readonly<Record<string, string>>;
  readonly spaces: Readonly<Record<string, string>>;
}

export const NO_VIEW: View = { active: null, focused: {}, zoomed: {}, spaces: {} };

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
    spaces: strings(parsed["spaces"]),
  };
}

/**
 * Saves this screen's view; null once it is saved, else why the storage refused it (full or denied). A refusal never
 * throws: the view lives on in memory, and only the next reload loses the selection and focus.
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

/** A space's key: its id in the document, behind its machine's permanent id when it is not this core's, as tabKey. */
export const spaceKey = (machineId: string | null, spaceId: string): string => `space:${tabKey(machineId, spaceId)}`;
