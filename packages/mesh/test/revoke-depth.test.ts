import { describe, expect, test } from "bun:test";
import type { Rec } from "../src/view/dag.ts";
import { viewOfRecords } from "../src/view/engine.ts";
import { ack, admit, type Draft, found, revoke, withChainNumbers } from "./fixtures/records.ts";
import { naiveView } from "./oracle/naive.ts";

/**
 * A founds and admits K and B; A revokes K and B acks it, so K's concurrent first mint Z1 is defeated. On that branch
 * K's mints admit each other `depth` deep, and once `window + batch` mints are live one revoke prunes the oldest `batch`
 * of them, so the branch stays within 12 members (A, K, B and at most 9 mints), by the newest mint or by K itself; then
 * the last mint revokes the founder. Its revoke's lineage walk must reach the defeated Z1 at any depth. When K prunes,
 * no earlier revoke has walked the chain, so the walk is one fresh pass.
 */
function mintChain(depth: number, pruner: "mint" | "minter", window = 8, batch = 1): Rec[] {
  const out: Draft[] = [
    found("F", "A"),
    admit("aK", "A", "K", ["F"]),
    admit("aB", "A", "B", ["aK"]),
    revoke("vK", "A", ["K"], ["aB"]),
    ack("kB", "B", ["vK"]),
  ];
  let last = "aB";
  let by = "K";
  let pruned = 0;
  for (let i = 1; i <= depth; i++) {
    out.push(admit(`m${i}`, by, `Z${i}`, [last]));
    last = `m${i}`;
    by = `Z${i}`;
    if (i - pruned >= window + batch) {
      const subjects = Array.from({ length: batch }, (_, j) => `Z${pruned + j + 1}`);
      pruned += batch;
      out.push(revoke(`r${i}`, pruner === "mint" ? by : "K", subjects, [last]));
      last = `r${i}`;
    }
  }
  out.push(revoke("x", by, ["A"], [last]));
  return withChainNumbers(out);
}

describe("contract: the revoke lineage walk goes all the way to the founding record", () => {
  for (const [pruner, depth] of (["mint", "minter"] as const).flatMap((p) =>
    [1, 9, 64, 65, 70, 100].map((d) => [p, d] as const),
  )) {
    test(`a revoke of the founder by a mint ${depth} admissions below a defeated mint is void (pruned by the ${pruner})`, () => {
      const view = viewOfRecords(mintChain(depth, pruner));
      expect([view.eff.has("x"), view.members, view.revoked]).toEqual([false, ["A", "B"], ["K"]]);
    });
  }

  test("the oracle agrees past the old 64-hop bound", () => {
    // The oracle evaluates every past and meet of the chain, so its work grows much faster than the record count. Five
    // mints pruned per revoke make the same 65-hop walk in 83 records instead of 128: 0.27 s of CPU instead of 0.64 s.
    const records = mintChain(65, "minter", 4, 5);
    expect(records.filter((rec) => rec.type === "admit" && rec.id.startsWith("m"))).toHaveLength(65);
    const oracle = naiveView(records);
    expect([oracle.eff.includes("x"), oracle.members, oracle.revoked]).toEqual([false, ["A", "B"], ["K"]]);
  });
});
