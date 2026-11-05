import { beforeAll, describe, expect, test } from "bun:test";
import { hashOf, MAX_PREV, parseRecord, type Signed, viewOf } from "@doriface/mesh";
import type { MeshStore } from "../state/mesh.ts";
import { appendOwn, mergeBatch } from "./merge.ts";
import { headsOfRecords, meshOf, peer, Signer, storeOf } from "./testing/mesh-peers.ts";

const [a, b, c] = [peer("a"), peer("b"), peer("c")];

/** b's store in a mesh a founded. */
function atB() {
  const { records, meshId } = meshOf([a, b]);
  const founder = new Signer(a, records);
  const store = storeOf(b, records);
  return { store, deps: { store, identity: b.machine.identity, meshId }, founder };
}

/**
 * A mesh a founded with b, and 200 acks of a's on its first heads, signed once for the fold tests: each case needs a
 * wide set of heads, not signatures of its own. Signing them per case, and passing a second wide batch through the
 * door's signature checks, was most of those cases' CPU, so their wall time followed the host's load (#559).
 */
function wideMesh() {
  const { records, meshId } = meshOf([a, b]);
  const founder = new Signer(a, records);
  const start = headsOfRecords(records);
  return { records, meshId, founder, start, acks: Array.from({ length: 200 }, () => founder.ack(start)) };
}

/**
 * b's store holding `records` as stored, not merged: a wide set of heads costs one signature check per record at the
 * door, which is not what the fold tests check and dominated their run time.
 */
function bOver(meshId: string, records: readonly Signed[]) {
  const store = storeOf(b, records);
  return { store, deps: { store, identity: b.machine.identity, meshId } };
}

const recordsOf = (store: MeshStore): readonly Signed[] => store.read()?.records ?? [];
const headsAt = (store: MeshStore): readonly string[] => headsOfRecords(recordsOf(store));
const acksBy = (store: MeshStore, who: string): readonly Signed[] =>
  recordsOf(store).filter((record) => {
    const body = parseRecord(record);
    return body?.type === "ack" && body.by === who;
  });

describe("automatic acks (S-3, section 5.5)", () => {
  let wide: ReturnType<typeof wideMesh>;
  beforeAll(() => {
    wide = wideMesh();
  });

  test("a merged admission is acked in the same store transaction, the ack naming it", () => {
    const { store, deps, founder } = atB();
    const admit = founder.admit(c, headsAt(store));
    let transactions = 0;
    const counted: Pick<MeshStore, "transact" | "read" | "catchUp"> = {
      read: () => store.read(),
      catchUp: (identity) => store.catchUp(identity),
      transact: (fn) => {
        transactions += 1;
        return store.transact(fn);
      },
    };
    const result = mergeBatch({ ...deps, store: counted }, [admit]);
    const after = store.read();
    expect(transactions).toBe(1);
    const ack = result.ack;
    if (ack === undefined) throw new Error("no ack");
    expect(after?.records.map(hashOf)).toEqual(expect.arrayContaining([hashOf(admit), hashOf(ack)]));
    expect(parseRecord(ack)?.prev).toContain(hashOf(admit));
  });

  test("acks and names are never acked", () => {
    const { store, deps, founder } = atB();
    mergeBatch(deps, [founder.ack(headsAt(store))]);
    mergeBatch(deps, [founder.name(headsAt(store), "a2")]);
    expect(acksBy(store, b.signPub)).toEqual([]);
  });

  test("a member the merged view revoked writes nothing", () => {
    const { store, deps, founder } = atB();
    const result = mergeBatch(deps, [founder.revoke(headsAt(store), b)]);
    expect(result.ack).toBeUndefined();
    expect(acksBy(store, b.signPub)).toEqual([]);
  });

  test.each([70, 120, 200])(
    "%i heads are folded by acks within the door's limits, and every record b signs stays effective (section 3.2)",
    (width) => {
      const { records, meshId, founder, start } = wide;
      const { store, deps } = bOver(meshId, [...records, ...wide.acks.slice(0, width)]);
      expect(headsAt(store).length).toBe(width);
      mergeBatch(deps, [founder.admit(c, start)]);
      expect(headsAt(store).length).toBeLessThanOrEqual(1);
      const own = acksBy(store, b.signPub);
      expect(own.length).toBeGreaterThan(1);
      for (const record of own) expect(parseRecord(record)?.prev.length).toBeLessThanOrEqual(64);
      const view = viewOf(recordsOf(store));
      expect(own.filter((record) => !view.eff.has(hashOf(record)))).toEqual([]);
      appendOwn(deps, { type: "name", signPub: b.signPub, name: `b${width}` });
      expect(viewOf(recordsOf(store)).name.get(b.signPub)).toBe(`b${width}`);
    },
  );

  // The covering head first, inside the first fold's reach, and past MAX_PREV, where no fold that takes heads from the
  // front reaches it: one fold names at most 41 of these heads (the 2048-byte body binds before MAX_PREV).
  test.each([0, 20, MAX_PREV])(
    "the first fold names the head that covers b's own latest record, wherever it sits among the heads (at %i)",
    (at) => {
      const { records, meshId, founder, start } = wide;
      const acked = bOver(meshId, records);
      mergeBatch(acked.deps, [founder.admit(c, start)]);
      const covering = founder.ack(headsAt(acked.store));
      const others = wide.acks.slice(0, MAX_PREV);
      const { store, deps } = bOver(meshId, [
        ...recordsOf(acked.store),
        ...others.slice(0, at),
        covering,
        ...others.slice(at),
      ]);
      expect(headsAt(store).indexOf(hashOf(covering))).toBe(at);
      const result = mergeBatch(deps, [founder.admit(peer("d"), start)]);
      const first = result.added.find((record) => parseRecord(record)?.by === b.signPub);
      if (first === undefined) throw new Error("b signed no fold");
      expect(parseRecord(first)?.prev).toContain(hashOf(covering));
      expect(headsAt(store).length).toBeLessThanOrEqual(1);
      const view = viewOf(recordsOf(store));
      expect(acksBy(store, b.signPub).filter((record) => !view.eff.has(hashOf(record)))).toEqual([]);
    },
  );
});

describe("what a replayed batch costs (abuse, section 5.2)", () => {
  test("records this host already stores evaluate no view, so a replay costs no view under the lock", () => {
    const { records, meshId } = meshOf([a, b]);
    let evaluations = 0;
    const store = storeOf(b, records, {
      evaluate: (set) => {
        evaluations += 1;
        return viewOf(set);
      },
    });
    const deps = { store, identity: b.machine.identity, meshId };
    const admit = new Signer(a, records).admit(c, headsOfRecords(records));
    mergeBatch(deps, [admit]);
    const stored = recordsOf(store);
    evaluations = 0;
    const replay = mergeBatch(deps, [admit, ...stored]);
    expect(replay.added).toEqual([]);
    expect(evaluations).toBe(0);
  });
});

describe("the dangling pool (S-1)", () => {
  test("a record whose past is missing is held out of the view, wanted, and stored once its past arrives", () => {
    const { store, deps, founder } = atB();
    const parent = founder.admit(c, headsAt(store));
    const child = founder.admit(peer("e"), [hashOf(parent)]);
    const held = mergeBatch(deps, [child]);
    expect(held.added).toEqual([]);
    expect(held.wanted).toEqual([hashOf(parent)]);
    expect(held.view.members.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(store.read()?.dangling.map(hashOf)).toEqual([hashOf(child)]);

    const healed = mergeBatch(deps, [parent]);
    expect(healed.added.slice(0, 2).map(hashOf)).toEqual([hashOf(parent), hashOf(child)]);
    expect(healed.view.members.map((entry) => entry.name)).toEqual(["a", "b", "c", "e"]);
    expect(store.read()?.dangling).toEqual([]);
  });

  test("a record by a signer whose admission has not arrived is held, not refused, and stored after it", () => {
    const { store, deps, founder } = atB();
    const admit = founder.admit(c, headsAt(store));
    const byC = new Signer(c, [...recordsOf(store), admit]).name([hashOf(admit)], "c2");
    const held = mergeBatch(deps, [byC]);
    expect(held.refused).toEqual([]);
    expect(store.read()?.dangling.map(hashOf)).toEqual([hashOf(byC)]);
    mergeBatch(deps, [admit]);
    expect(recordsOf(store).map(hashOf)).toEqual(expect.arrayContaining([hashOf(admit), hashOf(byC)]));
  });
});
