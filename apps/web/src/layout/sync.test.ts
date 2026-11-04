import { describe, expect, test } from "bun:test";
import { HcRpcError, isJsonObject, type JsonObject, type JsonValue } from "@doriface/protocol";
import { LayoutDoc, type DocCalls, type DocState } from "./sync.ts";

/** A core's document store with compare-and-set, and a way for "another client" to write between our calls. */
function store(initial: JsonValue) {
  let value = initial;
  let version = initial === null ? 0 : 1;
  const writes: JsonValue[] = [];
  let before: (() => void) | undefined;
  const calls: DocCalls = {
    get: async () => ({ value, version }),
    set: async (_on, next, at) => {
      before?.();
      before = undefined;
      if (at !== version) throw new HcRpcError({ code: -32000, message: "conflict", data: { kind: "conflict" } });
      value = next;
      version += 1;
      writes.push(next);
      return { version };
    },
  };
  return {
    calls,
    writes,
    current: () => value,
    other: (next: JsonValue) => {
      before = () => {
        value = next;
        version += 1;
      };
    },
    write: (next: JsonValue): number => {
      value = next;
      version += 1;
      return version;
    },
  };
}

const named = (doc: JsonObject | null, name: string): JsonObject => ({ ...doc, [name]: true });
const onlyWithTarget = (current: JsonObject | null): JsonObject | null =>
  isJsonObject(current) && current["target"] === true ? named(current, "mine") : null;

async function ready(calls: DocCalls): Promise<{ doc: LayoutDoc; states: DocState[] }> {
  const states: DocState[] = [];
  const doc = new LayoutDoc(calls, null, (state) => states.push(state));
  await doc.refresh();
  return { doc, states };
}

describe("the layout document sync", () => {
  test("writes an edit at the version it read", async () => {
    const core = store({ spaces: [] });
    const { doc } = await ready(core.calls);
    expect(await doc.edit((current) => named(current, "mine"))).toBe(true);
    expect(core.current()).toEqual({ spaces: [], mine: true });
  });

  test("after a conflict it reads the other client's document and makes the edit again on it", async () => {
    const core = store({ spaces: [] });
    const { doc } = await ready(core.calls);
    core.other({ spaces: [], theirs: true });
    expect(await doc.edit((current) => named(current, "mine"))).toBe(true);
    expect(core.current()).toEqual({ spaces: [], theirs: true, mine: true });
  });

  test("drops an edit that no longer applies to the other client's document", async () => {
    const core = store({ spaces: [], target: true });
    const { doc } = await ready(core.calls);
    core.other({ spaces: [] });
    expect(await doc.edit(onlyWithTarget)).toBe(false);
    expect(core.current()).toEqual({ spaces: [] });
    expect(doc.state).toEqual({ phase: "ready", doc: { spaces: [] }, version: 2 });
  });

  test("never writes a document it cannot read in full", async () => {
    const core = store({ spaces: [{ tabs: [{ root: { type: "grid" } }] }] });
    const { doc } = await ready(core.calls);
    expect(doc.state.phase).toBe("unreadable");
    expect(await doc.edit((current) => named(current, "mine"))).toBe(false);
    expect(core.writes).toEqual([]);
  });

  test("a doc event for a version it did not write reads the document again", async () => {
    const core = store({ spaces: [] });
    const { doc, states } = await ready(core.calls);
    const version = core.write({ spaces: [], theirs: true });
    await doc.heard(version);
    expect(doc.state).toEqual({ phase: "ready", doc: { spaces: [], theirs: true }, version });
    const shown = states.length;
    await doc.heard(version);
    expect(states).toHaveLength(shown);
  });
});
