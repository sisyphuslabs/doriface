import * as jsc from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { Dag } from "../src/view/dag.ts";
import { ViewCache, viewOfRecords } from "../src/view/engine.ts";
import { bigMesh } from "./fixtures/big-mesh.ts";

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
 * root, where this test file's own module state is not (it is reached through the test runner's stack).
 */
const MEASURED = Symbol("view-memory: measured subjects");

/**
 * Instances of each class still reachable after a full collection from `subjects` or from the heap's recorded roots
 * (handles, the global object, the state of every module the tests import), walked in a JSC heap snapshot. Two roots are left out, because
 * no program reference is behind them and they keep a released cell alive only by chance (#401): the conservative
 * scan of the native stack and registers, which the snapshot does not record (a stale slot there was seen keeping a
 * finished merge's Engine and its Dag alive at the same address run after run), and the JIT worklist, which holds the
 * cells a concurrent compile in flight was planned with. A value the test holds only in a local is therefore not
 * counted unless it is passed in `subjects`.
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

const MERGES = 256;

/** Heap one cold view at the cap may leave in a cache for a names-only mesh: views and history, no per-context statuses. */
const NAMES_BUDGET_MB = 96;
/** For the partition shape: a common past per accuser/record pair is n/32 words of bits, not a Set of ids. */
const PARTITION_BUDGET_MB = 24;
/**
 * For 2048 admissions: per-record views keep governing, not admitter, names or hostIds of every governed key. Measured
 * 210 MB with the trim and 433 MB without it.
 */
const ADMITS_BUDGET_MB = 320;

/** The heap a cache holds after one cold view of `shape`, read in a fresh bun process (test/fixtures/cache-heap.ts). */
async function heldMb(shape: string): Promise<number> {
  const child = Bun.spawn([process.execPath, new URL("./fixtures/cache-heap.ts", import.meta.url).pathname, shape], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  const reading: unknown = JSON.parse(text);
  if (typeof reading !== "object" || reading === null || !("heldMb" in reading) || typeof reading.heldMb !== "number")
    throw new Error(`unreadable heap reading: ${text}`);
  console.log(`${shape}: the cache holds ${reading.heldMb.toFixed(1)} MB`);
  return reading.heldMb;
}

describe("M-14: a ViewCache holds one mesh's history, not one engine per merge", () => {
  test("the heap probe sees a Dag that is still held (positive control)", () => {
    const mesh = bigMesh({ records: 32, revokes: 1, seed: 7 });
    const held = reachable(["Dag"]);
    const kept = [new Dag(mesh), new Dag(mesh)];
    expect((reachable(["Dag"], kept)["Dag"] ?? 0) - (held["Dag"] ?? 0)).toBe(kept.length);
  });

  test("single-record merges through one cache leave no per-merge Dag or Engine reachable", () => {
    const mesh = bigMesh({ records: MERGES, revokes: 4, seed: 3 });
    const cache = new ViewCache();
    const held = reachable(["Dag", "Engine"], cache);
    for (let n = 2; n <= mesh.length; n++) viewOfRecords(mesh.slice(0, n), cache);
    const left = reachable(["Dag", "Engine"], cache);
    expect((left["Dag"] ?? 0) - (held["Dag"] ?? 0)).toBeLessThanOrEqual(1);
    expect((left["Engine"] ?? 0) - (held["Engine"] ?? 0)).toBeLessThanOrEqual(1);
  });

  test("cache.clear() releases the history and the per-record results it held", () => {
    const mesh = bigMesh({ records: 64, revokes: 2, seed: 5 });
    const cache = new ViewCache();
    viewOfRecords(mesh, cache);
    const held = reachable(["History", "Shared"], cache);
    cache.clear();
    const left = reachable(["History", "Shared"], cache);
    expect([left["History"], left["Shared"]]).toEqual([(held["History"] ?? 0) - 1, (held["Shared"] ?? 0) - 1]);
    expect(viewOfRecords(mesh, cache).members).toEqual(viewOfRecords(mesh).members);
  });

  test(`a cold view of a names-only mesh at the cap keeps under ${NAMES_BUDGET_MB} MB in its cache`, async () => {
    const held = await heldMb("names-only");
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(NAMES_BUDGET_MB);
  }, 120_000);

  test(`a partition with revokes across it keeps under ${PARTITION_BUDGET_MB} MB in its cache`, async () => {
    const held = await heldMb("partition");
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(PARTITION_BUDGET_MB);
  }, 120_000);

  test(`2048 admissions, most of them over the cap, keep under ${ADMITS_BUDGET_MB} MB in the cache`, async () => {
    const held = await heldMb("admits-only-2048");
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(ADMITS_BUDGET_MB);
  }, 120_000);
});
