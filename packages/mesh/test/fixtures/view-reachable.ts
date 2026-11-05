// What a ViewCache keeps reachable after the M-14 probes (test/view-memory.test.ts), counted in a JSC debug heap
// snapshot. Run as its own process, `bun test/fixtures/view-reachable.ts <probe>`, so the snapshot and the walk cover
// only the probe's heap: in the test process they covered whatever every earlier test file left alive, and grew with
// it (17k nodes alone, 72k after the mesh suite, 41 s per test in the whole repository's run, #542). It prints
// {"counts": {class: n}, ...}; the test checks the counts.

import * as jsc from "bun:jsc";
import { Dag } from "../../src/view/dag.ts";
import { ViewCache, viewOfRecords } from "../../src/view/engine.ts";
import { bigMesh } from "./big-mesh.ts";

/** The parts of a JSC GCDebugging heap snapshot that reachable() reads. */
interface DebugSnapshot {
  /** <id, size, class name index, flags, label index, cell address, wrapped address> per node. */
  readonly nodes: readonly (number | string)[];
  readonly nodeClassNames: readonly string[];
  /** <from id, to id, edge type index, edge data> per edge. */
  readonly edges: readonly number[];
  /** <node id, reason label index, description label index> per GC root. */
  readonly roots: readonly number[];
  readonly labels: readonly string[];
}

/** A snapshot with its GC roots and their reasons, which Bun.generateHeapSnapshot() leaves out (not in bun-types). */
function debugSnapshot(): DebugSnapshot {
  const generate: unknown = Reflect.get(jsc, "generateHeapSnapshotForDebugging");
  if (typeof generate !== "function") throw new Error("bun:jsc has no generateHeapSnapshotForDebugging");
  return generate() as DebugSnapshot;
}

/**
 * The global property reachable() holds its subjects under while it takes its snapshot: the global object is a recorded
 * root, where a local of the probe is not (it is reached through the stack).
 */
const MEASURED = Symbol("view-reachable: measured subjects");

/**
 * Instances of each class still reachable after a full collection from `subjects` or from the heap's recorded roots
 * (handles, the global object, the state of every module the probe imports), walked in a JSC heap snapshot. Two roots
 * are left out, because no program reference is behind them and they keep a released cell alive only by chance (#401):
 * the conservative scan of the native stack and registers, which the snapshot does not record (a stale slot there was
 * seen keeping a finished merge's Engine and its Dag alive at the same address run after run), and the JIT worklist,
 * which holds the cells a concurrent compile in flight was planned with. A value the probe holds only in a local is
 * therefore not counted unless it is passed in `subjects`.
 */
function reachable(classes: readonly string[], ...subjects: unknown[]): Record<string, number> {
  Reflect.set(globalThis, MEASURED, subjects);
  Bun.gc(true);
  const snapshot = debugSnapshot();
  Reflect.deleteProperty(globalThis, MEASURED);
  const jit = snapshot.labels.indexOf("JITWorkList");
  const { edges } = snapshot;
  let ids = 0;
  for (let i = 0; i < snapshot.nodes.length; i += 7) ids = Math.max(ids, Number(snapshot.nodes[i]) + 1);
  // The edges out of each node id, as one array sliced by `start`.
  const start = new Int32Array(ids + 1);
  for (let i = 0; i < edges.length; i += 4) {
    const at = (edges[i] ?? 0) + 1;
    start[at] = (start[at] ?? 0) + 1;
  }
  for (let id = 0; id < ids; id++) start[id + 1] = (start[id + 1] ?? 0) + (start[id] ?? 0);
  const fill = start.slice(0, ids);
  const to = new Int32Array(edges.length / 4);
  for (let i = 0; i < edges.length; i += 4) {
    const from = edges[i] ?? 0;
    const at = fill[from] ?? 0;
    to[at] = edges[i + 1] ?? 0;
    fill[from] = at + 1;
  }
  const seen = new Uint8Array(ids);
  const queue: number[] = [];
  const visit = (id: number): void => {
    if (seen[id] === 1) return;
    seen[id] = 1;
    queue.push(id);
  };
  for (let i = 0; i < snapshot.roots.length; i += 3) if (snapshot.roots[i + 1] !== jit) visit(snapshot.roots[i] ?? 0);
  for (let id = queue.pop(); id !== undefined; id = queue.pop())
    for (let e = start[id] ?? 0; e < (start[id + 1] ?? 0); e++) visit(to[e] ?? 0);
  const wanted = new Map(classes.map((cls) => [snapshot.nodeClassNames.indexOf(cls), cls]));
  const counts = Object.fromEntries(classes.map((cls) => [cls, 0]));
  for (let i = 0; i < snapshot.nodes.length; i += 7) {
    const cls = wanted.get(Number(snapshot.nodes[i + 2]));
    if (cls !== undefined && seen[Number(snapshot.nodes[i])] === 1) counts[cls] = (counts[cls] ?? 0) + 1;
  }
  return counts;
}

/** Merges through one cache: each merge adds one record to the set before it. */
export const MERGES = 256;
/** The Dags the single-record probe keeps on purpose, which its one snapshot must count (the positive control). */
export const KEPT_DAGS = 2;

const PROBES: Readonly<Record<string, () => object>> = {
  /**
   * Dags and Engines reachable after MERGES single-record merges through one cache, with KEPT_DAGS Dags held on
   * purpose in the same snapshot. The process has built no Dag before, so every Dag counted is one the cache, a module
   * or the control keeps.
   */
  "single-record": () => {
    const mesh = bigMesh({ records: MERGES, revokes: 4, seed: 3 });
    const cache = new ViewCache();
    for (let n = 2; n <= mesh.length; n++) viewOfRecords(mesh.slice(0, n), cache);
    const kept = Array.from({ length: KEPT_DAGS }, () => new Dag(mesh));
    return { counts: reachable(["Dag", "Engine"], cache, kept) };
  },
  /**
   * History and Shared reachable from a cleared cache and from a control cache that evaluated the same mesh and was
   * not cleared, in one snapshot: the control's one History and one Shared must be seen, the cleared cache's must not.
   * Then the cleared cache evaluates again: its members must equal a fresh evaluation's.
   */
  clear: () => {
    const mesh = bigMesh({ records: 64, revokes: 2, seed: 5 });
    const cache = new ViewCache();
    const control = new ViewCache();
    viewOfRecords(mesh, cache);
    viewOfRecords(mesh, control);
    cache.clear();
    const counts = reachable(["History", "Shared"], cache, control);
    return {
      counts,
      members: [...viewOfRecords(mesh, cache).members],
      fresh: [...viewOfRecords(mesh).members],
    };
  },
};

if (import.meta.main) {
  const probe = PROBES[process.argv[2] ?? ""];
  if (probe === undefined) throw new Error(`probe: one of ${Object.keys(PROBES).join(", ")}`);
  console.log(JSON.stringify(probe()));
}
