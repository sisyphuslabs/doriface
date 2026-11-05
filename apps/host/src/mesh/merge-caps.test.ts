import { describe, expect, test } from "bun:test";
import { cpuHeadroom } from "../testing/cpu-headroom.ts";
import { door, encodeBody, hashOf, MAX_DANGLING, MAX_RECORDS, parseRecord, type Signed } from "@doriface/mesh";
import { mergeBatch } from "./merge.ts";
import { meshOf, peer, Signer, storeOf } from "./testing/mesh-peers.ts";

const missing = (i: number): string => hashOf({ body: `{"missing":${i}}`, sig: "" });

/**
 * `count` records after `first` that only fill the log: the door indexes stored records without verifying them again
 * (each passed its own door when it was stored), so they need distinct hashes, not real signatures. Signing 4096
 * records was 1.2-1.4 s of this test's CPU, none of it the property; the records the door judges are really signed.
 */
function filler(first: Signed, count: number): readonly Signed[] {
  const body = parseRecord(first);
  if (body === undefined) throw new Error("the first filler record does not parse");
  const records: Signed[] = [first];
  for (let i = 1; i < count; i++) {
    const prev = [hashOf(records[i - 1] ?? first)];
    records.push({ body: encodeBody({ ...body, n: body.n + i, prev }), sig: first.sig });
  }
  return records;
}

/**
 * Both tests keep the 30 s budget #255 gave them; what changed (#149) is the CPU spent under it. The door test signed
 * 4096 records to fill the log (1.2-1.4 s of CPU) and now signs only the two it judges (about 0.3 s); on 2 cores beside
 * 4 busy loops it timed out 3 times in 40 runs on dev.
 */
const SIGNATURES_BUDGET_MS = 30_000;

/**
 * The held records' fixture, signed once when the file loads: 300 real signatures, so each is a real record the door
 * must verify before it may take a pool slot (a forged record must never evict a real one). Signing them is setup; the
 * 300 verifications the merge runs are the property, and stay in the test (#149).
 */
const heldFixture = (() => {
  const [a, b] = [peer("a"), peer("b")];
  const { records, meshId } = meshOf([a, b]);
  const founder = new Signer(a, records);
  const held = Array.from({ length: MAX_DANGLING + 44 }, (_, i) => founder.name([missing(i)], `h${i}`));
  return { b, records, meshId, held };
})();

describe("the record cap a sync merge relies on (section 3.3)", () => {
  test(
    "the door refuses the 4097th record: a full log takes nothing more",
    cpuHeadroom(
      40,
      () => {
        const [a, b] = [peer("a"), peer("b")];
        const stored: Signed[] = [...meshOf([a, b]).records];
        const founder = new Signer(a, stored);
        const head = stored.at(-1) ?? { body: "", sig: "" };
        stored.push(...filler(founder.name([hashOf(head)], "a"), MAX_RECORDS - 1 - stored.length));
        const last = new Signer(a, stored).name([hashOf(stored.at(-1) ?? head)], "a");
        expect(door(last, stored).ok).toBe(true);
        stored.push(last);
        const extra = new Signer(a, stored).name([hashOf(last)], "a");
        expect(stored.length).toBe(MAX_RECORDS);
        expect(door(extra, stored)).toMatchObject({ ok: false, reason: "mesh log full" });
      },
      SIGNATURES_BUDGET_MS,
    ),
    SIGNATURES_BUDGET_MS,
  );
});

describe("the dangling cap through a sync merge (section 3.3)", () => {
  test(
    "the pool keeps the newest 256 held records",
    cpuHeadroom(
      50,
      () => {
        const { b, records, meshId, held } = heldFixture;
        const store = storeOf(b, records);
        const result = mergeBatch({ store, identity: b.machine.identity, meshId }, held);
        expect(result.added).toEqual([]);
        expect(store.read()?.dangling.map(hashOf)).toEqual(held.slice(-MAX_DANGLING).map(hashOf));
      },
      SIGNATURES_BUDGET_MS,
    ),
    SIGNATURES_BUDGET_MS,
  );
});
