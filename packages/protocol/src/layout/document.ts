import { isJsonObject, type JsonObject, type JsonValue } from "../json.ts";
import { problemIn, type Node } from "./node.ts";

/** The core document herdr-app keeps its spaces, tabs and split trees in, one per machine (`doc.get` `on`). */
export const LAYOUT_DOC = "herdr-app";

export type ReadDocument =
  | { readonly kind: "empty" }
  | { readonly kind: "ok"; readonly doc: JsonObject }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface DocTab {
  readonly id: string;
  readonly name: string;
  readonly space: string;
  readonly root: Node;
}

const unreadable = (reason: string): ReadDocument => ({ kind: "unreadable", reason });
const textOrMissing = (value: JsonValue | undefined): boolean => value === undefined || typeof value === "string";
const list = (value: JsonValue | undefined): readonly JsonValue[] | null =>
  value === undefined ? [] : Array.isArray(value) ? value : null;

/** herdr-app's own reading rules (`src/mirror.rs`): missing fields default, a wrong one makes the whole document unreadable. */
export function readDocument(value: JsonValue): ReadDocument {
  if (value === null) return { kind: "empty" };
  if (!isJsonObject(value)) return unreadable("the document is not an object");
  const spaces = list(value["spaces"]);
  if (spaces === null) return unreadable("spaces is not a list");
  for (const space of spaces) {
    if (!isJsonObject(space)) return unreadable("a space is not an object");
    if (!["id", "name", "folder"].every((key) => textOrMissing(space[key])))
      return unreadable("a space field is not text");
    const tabs = list(space["tabs"]);
    if (tabs === null) return unreadable("a space's tabs is not a list");
    for (const tab of tabs) {
      if (!isJsonObject(tab)) return unreadable("a tab is not an object");
      if (!textOrMissing(tab["id"]) || !textOrMissing(tab["name"])) return unreadable("a tab field is not text");
      const problem = tab["root"] === undefined ? null : problemIn(tab["root"]);
      if (problem !== null) return unreadable(problem);
    }
  }
  return { kind: "ok", doc: value };
}

const text = (value: JsonValue | undefined): string => (typeof value === "string" ? value : "");
const EMPTY_ROOT: Node = { children: [], id: "", type: "row" };

function spacesOf(doc: JsonObject): readonly JsonObject[] {
  const spaces = doc["spaces"];
  return Array.isArray(spaces) ? spaces.filter(isJsonObject) : [];
}

function tabsIn(space: JsonObject): readonly JsonObject[] {
  const tabs = space["tabs"];
  return Array.isArray(tabs) ? tabs.filter(isJsonObject) : [];
}

export function tabsOf(doc: JsonObject): readonly DocTab[] {
  return spacesOf(doc).flatMap((space) =>
    tabsIn(space).map((tab) => ({
      id: text(tab["id"]),
      name: text(tab["name"]),
      space: text(space["id"]),
      root: isJsonObject(tab["root"]) ? tab["root"] : EMPTY_ROOT,
    })),
  );
}

/**
 * The document with one tab's tree replaced by `edit`, or null when the tab is gone or the edit does not apply. Only
 * the objects on the way down to that tab are new: every other space, tab and node is the object that was read.
 */
export function editTab(doc: JsonObject, tabId: string, edit: (root: Node) => Node | null): JsonObject | null {
  let edited: JsonObject | null = null;
  const spaces = spacesOf(doc).map((space) => {
    const tabs = tabsIn(space);
    const index = tabs.findIndex((tab) => text(tab["id"]) === tabId);
    const tab = tabs[index];
    if (tab === undefined || edited !== null) return space;
    const root = edit(isJsonObject(tab["root"]) ? tab["root"] : EMPTY_ROOT);
    if (root === null) return space;
    edited = { ...space, tabs: tabs.with(index, { ...tab, root }) };
    return edited;
  });
  return edited === null ? null : { ...doc, spaces };
}

/**
 * The document with a tab added to a space, or as the first tab of a new space when `space` names none in it. The tab
 * goes right after the tab `after` names, as herdr-app's `add_tab` puts it after the space's selected one, else last.
 */
export function addTab(doc: JsonObject | null, space: NewSpace, tab: JsonObject, after?: string): JsonObject {
  const spaces = doc === null ? [] : spacesOf(doc);
  const at = spaces.findIndex((each) => text(each["id"]) === space.id);
  const existing = spaces[at];
  if (existing === undefined) {
    return { ...doc, spaces: [...spaces, { folder: space.folder, id: space.id, name: space.name ?? "", tabs: [tab] }] };
  }
  const tabs = tabsIn(existing);
  const before = after === undefined ? -1 : tabs.findIndex((each) => text(each["id"]) === after);
  const placed = before === -1 ? [...tabs, tab] : tabs.toSpliced(before + 1, 0, tab);
  return { ...doc, spaces: spaces.with(at, { ...existing, tabs: placed }) };
}

export interface NewSpace {
  readonly id: string;
  readonly folder: string;
  /** A new space's name; empty names it after where its first terminal is. */
  readonly name?: string;
}

/** A space as the sidebar lists it: its name and folder as saved, and its tabs' ids in their order. */
export interface DocSpace {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly tabs: readonly string[];
}

export function docSpaces(doc: JsonObject): readonly DocSpace[] {
  return spacesOf(doc).map((space) => ({
    id: text(space["id"]),
    name: text(space["name"]),
    folder: text(space["folder"]),
    tabs: tabsIn(space).map((tab) => text(tab["id"])),
  }));
}

/**
 * The document with a tab moved to index `to` among its own space's tabs (clamped), the others keeping their order; null
 * when the tab is gone or already there, so nothing is written.
 */
export function moveTab(doc: JsonObject, tabId: string, to: number): JsonObject | null {
  const spaces = spacesOf(doc);
  const at = spaces.findIndex((space) => tabsIn(space).some((tab) => text(tab["id"]) === tabId));
  const space = spaces[at];
  if (space === undefined) return null;
  const tabs = tabsIn(space);
  const from = tabs.findIndex((tab) => text(tab["id"]) === tabId);
  const target = Math.max(0, Math.min(tabs.length - 1, to));
  const moving = tabs[from];
  if (moving === undefined || target === from) return null;
  const placed = tabs.toSpliced(from, 1).toSpliced(target, 0, moving);
  return { ...doc, spaces: spaces.with(at, { ...space, tabs: placed }) };
}

/** The document without a tab; a space left with no tab goes too, as herdr-app's `remove_tab` does. */
export function removeTab(doc: JsonObject, tabId: string): JsonObject | null {
  const spaces = spacesOf(doc);
  const at = spaces.findIndex((space) => tabsIn(space).some((tab) => text(tab["id"]) === tabId));
  const space = spaces[at];
  if (space === undefined) return null;
  const tabs = tabsIn(space).filter((tab) => text(tab["id"]) !== tabId);
  const next = tabs.length === 0 ? spaces.filter((_, index) => index !== at) : spaces.with(at, { ...space, tabs });
  return { ...doc, spaces: next };
}
