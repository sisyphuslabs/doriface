import { expect, test } from "bun:test";
import { MAX_RECORDS } from "../src/records/types.ts";
import type { Rec } from "../src/view/dag.ts";
import { ViewCache, viewOfRecords } from "../src/view/engine.ts";
import { bigMesh } from "./fixtures/big-mesh.ts";

/**
 * #86 at the cap: an honest mesh, then 64 revokes one member backdated onto its own early record (each naming 8
 * members, so most later acks are concurrent with a revoke of their signer), then honest acks merged one at a time
 * through one ViewCache, 4096 records in all. Before #86 every merge judged again every ack concurrent with those
 * revokes, because their statuses were memoized per set object and each merge builds a new set. Measured on a
 * 14-core host at load average 120-148: the merge median was 137.5 ms before and 6.8 ms after, against a cold view
 * of 7.8-11.7 s.
 *
 * The merge is gated against a cold view of the same set in the same process, so load slows both sides together
 * (0.09% after, 1.2% before, gate 0.5%), and its median is held within the design's 50 ms merge budget.
 */
const BACKDATED = 64;
const SUBJECTS = 8;
const WARM = 16;
const MERGES = 32;
const DESIGN_MERGE_MS = 50;
const MERGE_SHARE_OF_COLD = 0.005;

function backdated(): { readonly set: readonly Rec[]; readonly acks: readonly Rec[] } {
  const honest = bigMesh({ records: MAX_RECORDS - BACKDATED - WARM - MERGES, revokes: 0, seed: 20261105 });
  const early = honest[40];
  if (early === undefined) throw new Error("the honest mesh is too small");
  const revoker = early.by;
  const others = [...viewOfRecords(honest).members].filter((k) => k !== revoker);
  const top = new Map<string, number>();
  for (const r of honest) top.set(r.by, Math.max(top.get(r.by) ?? 0, r.n));
  const named = new Set(honest.flatMap((r) => r.prev));
  const revokes: Rec[] = [];
  for (let i = 0; i < BACKDATED; i++) {
    const subjects = Array.from({ length: SUBJECTS }, (_, j) => others[(i + j) % others.length] ?? "");
    const prev = [revokes[i - 1]?.id ?? early.id];
    revokes.push({
      id: `x${String(i).padStart(3, "0")}`,
      type: "revoke",
      by: revoker,
      subjects,
      prev,
      n: early.n + 1 + i,
    });
  }
  let heads = [...honest.filter((r) => !named.has(r.id)).map((r) => r.id), revokes.at(-1)?.id ?? ""];
  const acks: Rec[] = [];
  for (let i = 0; i < WARM + MERGES; i++) {
    const by = others[i % others.length] ?? "";
    const n = (top.get(by) ?? 0) + 1;
    top.set(by, n);
    const ack: Rec = { id: `h${String(i).padStart(3, "0")}`, type: "ack", by, prev: heads, n };
    acks.push(ack);
    heads = [ack.id];
  }
  return { set: [...honest, ...revokes], acks };
}

const timed = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

test("#86: with 64 backdated revokes at 4096 records, an ack merge judges only the new ack again (median of 32 merges)", () => {
  const { set, acks } = backdated();
  const all = [...set, ...acks];
  expect(all).toHaveLength(MAX_RECORDS);
  const cache = new ViewCache();
  let current = [...set];
  void viewOfRecords(current, cache).eff.size;
  for (const ack of acks.slice(0, WARM)) {
    current = current.concat(ack);
    void viewOfRecords(current, cache).eff.size;
  }
  const merges: number[] = [];
  for (const ack of acks.slice(WARM)) {
    current = current.concat(ack);
    merges.push(timed(() => void viewOfRecords(current, cache).eff.size));
  }
  const cold = timed(() => void viewOfRecords(all).eff.size);
  expect([...viewOfRecords(current, cache).eff]).toEqual([...viewOfRecords(all).eff]);
  const median = merges.toSorted((a, b) => a - b)[MERGES / 2] ?? Number.POSITIVE_INFINITY;
  console.log(
    `#86 merge at ${all.length} with ${BACKDATED} backdated revokes: median ${median.toFixed(1)} ms (budget ` +
      `${DESIGN_MERGE_MS} ms); cold view ${cold.toFixed(0)} ms; merge/cold ${(median / cold).toFixed(4)} (gate ${MERGE_SHARE_OF_COLD})`,
  );
  expect(median / cold).toBeLessThan(MERGE_SHARE_OF_COLD);
  expect(median).toBeLessThan(DESIGN_MERGE_MS);
}, 300_000);
