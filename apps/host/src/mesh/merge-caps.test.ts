import { describe, expect, test } from "bun:test";
import { door, hashOf, MAX_DANGLING, MAX_RECORDS, type Signed } from "@doriface/mesh";
import { mergeBatch } from "./merge.ts";
import { meshOf, peer, Signer, storeOf } from "./testing/mesh-peers.ts";

const missing = (i: number): string => hashOf({ body: `{"missing":${i}}`, sig: "" });

/** 4096 real signatures and door checks: bounded well above the measured 3-5 s. */
const REAL_SIGNATURES_MS = 30_000;

/**
 * 300 real signatures and 300 door checks, each a pure-JS ed25519 verify the door must run before a record may take a
 * pool slot (a forged record must never evict a real one), so the work cannot shrink below MAX_DANGLING + 1 records.
 * Measured: 0.4 s alone on a fast workstation, 2.2 s on a Linux build host at load 77, and pinned to 2 cores beside 16 busy
 * loops (host load 100-155) p50 3.4-9.2 s and max 10.3 s over 60 runs, 4 of the first 20 past bun's 5 s default.
 * 30 s is about 3 times that max.
 */
const HELD_RECORDS_MS = 30_000;

describe("the record cap a sync merge relies on (section 3.3)", () => {
  test(
    "the door refuses the 4097th record: a full log takes nothing more",
    () => {
      const [a, b] = [peer("a"), peer("b")];
      const stored: Signed[] = [...meshOf([a, b]).records];
      const founder = new Signer(a, stored);
      while (stored.length < MAX_RECORDS)
        stored.push(founder.name([hashOf(stored.at(-1) ?? stored[0] ?? { body: "", sig: "" })], "a"));
      const extra = founder.name([hashOf(stored.at(-1) ?? { body: "", sig: "" })], "a");
      expect(door(extra, stored)).toMatchObject({ ok: false, reason: "mesh log full" });
      const last = stored.at(-1) ?? { body: "", sig: "" };
      expect(door(last, stored.slice(0, -1)).ok).toBe(true);
    },
    REAL_SIGNATURES_MS,
  );
});

describe("the dangling cap through a sync merge (section 3.3)", () => {
  test(
    "the pool keeps the newest 256 held records",
    () => {
      const [a, b] = [peer("a"), peer("b")];
      const { records, meshId } = meshOf([a, b]);
      const store = storeOf(b, records);
      const founder = new Signer(a, records);
      const held = Array.from({ length: MAX_DANGLING + 44 }, (_, i) => founder.name([missing(i)], `h${i}`));
      const result = mergeBatch({ store, identity: b.machine.identity, meshId }, held);
      expect(result.added).toEqual([]);
      expect(store.read()?.dangling.map(hashOf)).toEqual(held.slice(-MAX_DANGLING).map(hashOf));
    },
    HELD_RECORDS_MS,
  );
});
