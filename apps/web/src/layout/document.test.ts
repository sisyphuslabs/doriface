import { describe, expect, test } from "bun:test";
import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "@doriface/protocol";
import { editTab, readDocument, tabsOf } from "./document.ts";
import { panesOf, splitPane, terminalBlock } from "./tree.ts";

// Written by herdr-app 0.1.12 against hc 0.1.17: ⌘D ⌘⇧D ⌘D ⌘⇧D in one tab, a second tab split down then beside a
// herdr-app panel. Only the folder path was replaced.
const FIXTURE = parseJson(await Bun.file(new URL("./fixtures/herdr-app-0.1.12.json", import.meta.url)).text());

type Step = string | number;

function at(value: JsonValue, ...path: readonly Step[]): JsonValue {
  let here: JsonValue = value;
  for (const step of path) {
    const next: JsonValue | undefined = Array.isArray(here)
      ? here[Number(step)]
      : isJsonObject(here)
        ? here[String(step)]
        : undefined;
    if (next === undefined) throw new Error(`nothing at ${path.join(".")}`);
    here = next;
  }
  return here;
}

/** A copy of `value` with the field at `path` set to `to` (or removed when `to` is undefined). */
function setAt(value: JsonValue, path: readonly Step[], to: JsonValue | undefined): JsonValue {
  const [step, ...rest] = path;
  if (step === undefined) return to ?? null;
  if (Array.isArray(value)) {
    return value.map((item: JsonValue, index: number) => (index === Number(step) ? setAt(item, rest, to) : item));
  }
  if (!isJsonObject(value)) throw new Error(`cannot step into ${JSON.stringify(value)}`);
  const key = String(step);
  if (rest.length === 0 && to === undefined)
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
  const entries = Object.entries(value).map(([k, v]): [string, JsonValue] => [k, k === key ? setAt(v, rest, to) : v]);
  return key in value ? Object.fromEntries(entries) : { ...value, [key]: setAt({}, rest, to) };
}

function ok(value: JsonValue): JsonObject {
  const read = readDocument(value);
  if (read.kind !== "ok") throw new Error(`not readable: ${JSON.stringify(read)}`);
  return read.doc;
}

const TAB = "tbff1e9c7fe9d99f6cd247be825a5da61a";
const FIRST = "p5de884413ed6ec6e525cea922cedfd72";
const DEEPEST = "p986c8fa4187d4d895e540c2850573fac";
const FIRST_PATH = ["spaces", 0, "tabs", 0, "root", "children", 0] as const;
const DEEP_COLUMN = ["spaces", 0, "tabs", 0, "root", "children", 1, "children", 1, "children", 1] as const;

const splitRight = (doc: JsonObject, target: string): JsonObject => {
  const edited = editTab(doc, TAB, (root) => splitPane(root, target, "row", terminalBlock("pnew", "t8"), "snew"));
  if (edited === null) throw new Error("the split was refused");
  return edited;
};

describe("the herdr-app document", () => {
  test("reads every tab of a document herdr-app wrote, with its panes in tree order", () => {
    const tabs = tabsOf(ok(FIXTURE));
    expect(tabs.map((tab) => [tab.id, tab.name])).toEqual([
      [TAB, ""],
      ["tb75ab417b08a576fc183e9e363e046aab", "build"],
    ]);
    expect(panesOf(tabs[0]?.root ?? {}).map((pane) => pane.terminal)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(panesOf(tabs[1]?.root ?? {}).map((pane) => [pane.terminal, pane.mod])).toEqual([
      ["t6", null],
      ["t7", null],
      [null, "files"],
    ]);
  });

  test("an edit rewrites only the path to the edited node and keeps every other byte", () => {
    const doc = ok(FIXTURE);
    const edited = splitRight(doc, DEEPEST);
    // Untouched siblings are the very objects that were read, so they serialize exactly as herdr-app wrote them.
    expect(at(edited, "spaces", 0, "tabs", 1)).toBe(at(doc, "spaces", 0, "tabs", 1));
    expect(at(edited, ...FIRST_PATH)).toBe(at(doc, ...FIRST_PATH));
    expect(at(edited, ...DEEP_COLUMN, "children", 0)).toBe(at(doc, ...DEEP_COLUMN, "children", 0));
    expect(at(edited, ...DEEP_COLUMN, "children", 1, "children", 0)).toBe(at(doc, ...DEEP_COLUMN, "children", 1));
    const wrapped = {
      children: [at(doc, ...DEEP_COLUMN, "children", 1), { content: { terminal: "t8" }, id: "pnew", type: "block" }],
      id: "snew",
      type: "row",
    };
    expect(JSON.stringify(edited)).toBe(JSON.stringify(setAt(FIXTURE, [...DEEP_COLUMN, "children", 1], wrapped)));
  });

  test("splitting along the parent's own axis adds a sibling and halves the target's share, as herdr-app does", () => {
    const children = at(splitRight(ok(FIXTURE), FIRST), "spaces", 0, "tabs", 0, "root", "children");
    if (!Array.isArray(children)) throw new Error("no children");
    expect(children.map((child: JsonValue) => [at(child, "id"), at(child, "size")])).toEqual([
      [FIRST, { weight: 0.25 }],
      ["pnew", { weight: 0.25 }],
      ["s94e4cc5415d3de326f8d27235ef98c59", { weight: 0.5 }],
    ]);
  });

  test("keeps fields it does not know on the nodes it edits", () => {
    const value = setAt(FIXTURE, [...FIRST_PATH, "border"], { color: "accent", width: 2 });
    expect(at(splitRight(ok(value), FIRST), ...FIRST_PATH, "border")).toEqual({ color: "accent", width: 2 });
  });

  test("a document with a node type this version does not know is read-only, never guessed at", () => {
    expect(readDocument(setAt(FIXTURE, [...FIRST_PATH, "type"], "grid"))).toEqual({
      kind: "unreadable",
      reason: 'a layout node of type "grid"',
    });
    expect(readDocument(setAt(FIXTURE, [...FIRST_PATH, "type"], undefined))).toEqual({
      kind: "unreadable",
      reason: "a layout node without a type",
    });
    expect(readDocument({ spaces: 3 })).toEqual({ kind: "unreadable", reason: "spaces is not a list" });
  });

  test("a document never written reads as empty", () => {
    expect(readDocument(null)).toEqual({ kind: "empty" });
  });
});
