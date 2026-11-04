import { describe, expect, test } from "bun:test";
import { failClosedOfRecords } from "../src/fail-closed.ts";
import { ack, admit, found, revoke, withChainNumbers } from "./fixtures/records.ts";
import { staleForkScenarios } from "./fixtures/scenarios-stale.ts";

const scenario = (id: string) => {
  const match = staleForkScenarios.find((s) => s.id === id);
  if (match === undefined) throw new Error(`no scenario ${id}`);
  return match;
};

const sorted = (facts: ReturnType<typeof failClosedOfRecords>) =>
  facts.map((fact) => ({ revokedKey: fact.revokedKey, removed: fact.removed.toSorted() }));

describe("design 3.7: the members a conflict no voter could decide removed, and the revoked key behind it", () => {
  test.each(["P1b", "P2", "P7"])("%s: every honest member the fail-closed view lacks, removed by B", (id) => {
    const s = scenario(id);
    const removed = s.expectMembers.filter((k) => !(s.residual?.members ?? []).includes(k)).toSorted();
    const facts = sorted(failClosedOfRecords(withChainNumbers(s.records)));
    expect(facts.find((fact) => fact.revokedKey === "B")?.removed).toEqual(removed);
    // At 0:0 the record set cannot tell the sides apart: only B's fact may name an honest member.
    expect(facts.every((fact) => fact.revokedKey === "B" || !fact.removed.some((key) => removed.includes(key)))).toBe(
      true,
    );
  });

  test("P13 (N = 2, the minter testifying): its intended view is the fail-closed one, so A is reported removed", () => {
    expect(failClosedOfRecords(withChainNumbers(scenario("P13").records)).map((fact) => fact.removed)).toContainEqual(
      expect.arrayContaining(["A"]),
    );
  });

  test("P1: only a mint is tie-voided, so no member was removed", () => {
    expect(failClosedOfRecords(withChainNumbers(scenario("P1").records))).toEqual([]);
  });

  test("a decidable revoke removes nobody fail-closed", () => {
    const records = withChainNumbers([
      found("F", "A"),
      admit("aB", "A", "B", ["F"]),
      admit("aC", "A", "C", ["aB"]),
      ack("kB", "B", ["aC"]),
      ack("kC", "C", ["kB"]),
      revoke("vB", "A", ["B"], ["kC"]),
    ]);
    expect(failClosedOfRecords(records)).toEqual([]);
  });
});
