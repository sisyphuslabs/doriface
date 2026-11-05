import { expect, spyOn, test } from "bun:test";
import * as mesh from "@doriface/mesh";
import { hashOf, type Signed, viewOf } from "@doriface/mesh";
import type { MeshTx } from "../state/mesh-tx.ts";
import * as authorize from "./authorize-index.ts";
import { mergeBatch } from "./merge.ts";
import { meshOf, peer, Signer, storeOf } from "./testing/mesh-peers.ts";

const [a, b, c] = [peer("a"), peer("b"), peer("c")];
/** a's acks on one head: more than one fold names, so b's merge of an admission signs several acks in one transaction. */
const WIDTH = 120;

interface AckWork {
  readonly evaluations: number;
  readonly rebuilds: number;
  /** Records the view evaluations and the authorize index rebuilds read. */
  readonly read: number;
  /** Distinct records AckCover parsed or hashed. */
  readonly covered: number;
  /** Distinct records anything parsed or hashed (the heads, the counter, the door; all memoized per record). */
  readonly touched: number;
}

/**
 * The work of each ack b signs while it merges an admission into `size` stored records: a chain of a's acks, then
 * WIDTH acks of a's on its head, so b folds the heads before its ack.
 */
function acksOver(size: number): { readonly stored: number; readonly acks: readonly AckWork[] } {
  const { records, meshId } = meshOf([a, b]);
  const founder = new Signer(a, records);
  const all: Signed[] = [...records];
  const last = all.at(-1);
  if (last === undefined) throw new Error("an empty mesh");
  let head = hashOf(last);
  while (all.length < size - WIDTH) {
    const ack = founder.ack([head]);
    all.push(ack);
    head = hashOf(ack);
  }
  for (let i = 0; i < WIDTH; i++) all.push(founder.ack([head]));
  const admit = founder.admit(c, [head]);
  let evaluations = 0;
  let evaluated = 0;
  const store = storeOf(b, all, {
    evaluate: (set) => {
      evaluations += 1;
      evaluated += set.length;
      return viewOf(set);
    },
  });
  const rebuilds = spyOn(authorize, "indexOf");
  // Which reads are AckCover's is told by the stack: the codec is shared by every caller in the sign.
  const covered = new Set<Signed>();
  const touched = new Set<Signed>();
  const read = (record: Signed): void => {
    touched.add(record);
    if (new Error().stack?.includes("ack-cover.ts") === true) covered.add(record);
  };
  const { parseRecord, hashOf: hash } = mesh;
  const reads = [
    spyOn(mesh, "parseRecord").mockImplementation((record) => {
      read(record);
      return parseRecord(record);
    }),
    spyOn(mesh, "hashOf").mockImplementation((record) => {
      read(record);
      return hash(record);
    }),
  ];
  const acks: AckWork[] = [];
  const counted = (tx: MeshTx): MeshTx => ({
    get records() {
      return tx.records;
    },
    get dangling() {
      return tx.dangling;
    },
    merge: (incoming) => tx.merge(incoming),
    view: () => tx.view(),
    sign: (identity, build) => {
      const before = { evaluations, evaluated, rebuilds: rebuilds.mock.calls.length };
      covered.clear();
      touched.clear();
      const record = tx.sign(identity, build);
      const calls = rebuilds.mock.calls.slice(before.rebuilds);
      acks.push({
        evaluations: evaluations - before.evaluations,
        rebuilds: calls.length,
        read: evaluated - before.evaluated + calls.reduce((sum, [set]) => sum + set.length, 0),
        covered: covered.size,
        touched: touched.size,
      });
      return record;
    },
  });
  try {
    const deps = {
      store: {
        read: () => store.read(),
        catchUp: (identity: typeof b.machine.identity) => store.catchUp(identity),
        transact: <T>(fn: (tx: MeshTx) => T): T => store.transact((tx) => fn(counted(tx))),
      },
      identity: b.machine.identity,
      meshId,
    };
    if (mergeBatch(deps, [admit]).ack === undefined) throw new Error("b signed no ack");
  } finally {
    for (const spy of [rebuilds, ...reads]) spy.mockRestore();
  }
  return { stored: all.length, acks };
}

/**
 * Counted, not timed (#567): an S-3 fold signs its acks in one transaction (`fitHeads`), and each persists the counter
 * before it is signed. That write used to evaluate the whole view again and rebuild the authorize index from every
 * record, for every ack. Now an own ack that witnesses no revoke conflict keeps the index: no ack after the merge's
 * first evaluates or rebuilds. What stays per transaction is AckCover, which reads the stored set once, at the second
 * ack, and one record (the ack it checks) at each later one. The first ack follows the merge, whose new records the
 * index must cover: it is the control that the counters see a rebuild.
 */
test("own fold acks after the merge's first evaluate no view and rebuild no index; the cover reads the set once", () => {
  const work = [256, 2048].map(acksOver);
  for (const { stored, acks } of work) console.log(`${stored} records: ${JSON.stringify(acks)}`);
  for (const { stored, acks } of work) {
    const [first, second, ...rest] = acks;
    expect(first).toMatchObject({ rebuilds: 1, covered: 0 });
    expect(first?.read).toBeGreaterThanOrEqual(stored);
    expect(second).toMatchObject({ evaluations: 0, rebuilds: 0, read: 0 });
    expect(second?.covered).toBeGreaterThanOrEqual(stored);
    expect(rest.length).toBeGreaterThanOrEqual(1);
    for (const ack of rest) expect(ack).toMatchObject({ evaluations: 0, rebuilds: 0, read: 0, covered: 1 });
  }
  const later = (at: number) =>
    work[at]?.acks
      .slice(2)
      .map(({ evaluations, rebuilds, read, covered }) => ({ evaluations, rebuilds, read, covered }));
  expect(later(0)).toEqual(later(1) ?? []);
}, 120_000);
