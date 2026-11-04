import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { DialPolicy } from "./dial-policy.ts";
import { HostSync } from "./host-sync.ts";
import { liveFactsOf } from "./live-facts.ts";
import { storedMeshStatus } from "./status-store.ts";
import { syncHooks } from "./sync-hooks.ts";
import { FakeClock, seededRandom, settle } from "./testing/fake-clock.ts";
import { meshOf, peer, storeOf } from "./testing/mesh-peers.ts";

const RUN_TMP = process.env["TMPDIR"] ?? ".";

describe("a running host's mesh status (sections 8.2 and 8.6)", () => {
  test("shows the live dial policy: a gated member, the 4429 halving and a dial waiting for the budget", async () => {
    const [a, b, c, d] = [peer("a"), peer("b"), peer("c"), peer("d")];
    const { records } = meshOf([a, b, c, d]);
    const mesh = storeOf(b, records);
    const clock = new FakeClock();
    const sync = new HostSync({
      identity: b.machine.identity,
      mesh,
      relay: {
        url: "ws://relay.invalid",
        createSocket: () => {
          throw new Error("no relay here");
        },
      },
      hc: { hc: "hc-not-installed" },
      stateDir: mkdtempSync(join(RUN_TMP, "dh-status-live-")),
      program: "/opt/doriface-host",
      closeRevoked: () => undefined,
      log: () => undefined,
      clock,
      random: seededRandom(3),
    });
    sync.changed();
    await clock.advance(1);
    const runtime = sync.runtime;
    if (runtime === undefined) throw new Error("the mesh runtime did not start");
    runtime.policy.report(c.signPub, 4404);
    runtime.policy.report(d.signPub, 4429);
    const grants = Array.from({ length: 7 }, (_, index) => runtime.policy.acquire(`budget-${index}`, "push"));
    await settle();
    const status = storedMeshStatus(mesh, b.machine.identity, syncHooks(sync, clock));
    const row = (who: typeof c) => status?.members.find((member) => member.hostId === who.hostId);
    const misses = runtime.policy.gate(c.signPub)?.misses ?? 0;
    expect(misses).toBeGreaterThan(0);
    expect(row(c)?.gate).toEqual({ kind: "offline", refusals: misses, nextProbeAt: expect.any(String) });
    expect(status?.budget.halvedUntil).toEqual(expect.any(String));
    expect(status?.budget.waiting).toBe(runtime.policy.waiting());
    expect(runtime.policy.waiting()).toBeGreaterThan(0);
    await sync.stop();
    await clock.advance(120_000);
    await Promise.all(grants);
  });
});

describe("a running host's mesh lines in status (section 8.1)", () => {
  test("shows each member's line as herdr last listed it, keyed by the member", () => {
    const [a, b, c] = [peer("a"), peer("b"), peer("c")];
    const clock = new FakeClock();
    const policy = new DialPolicy({ clock, random: seededRandom(1), onDue: () => undefined });
    const machine = {
      host: "b",
      id: "core-b",
      name: "b",
      state: "unreachable",
      target: "x",
      version: "1",
      via: true,
      why: "no route",
    };
    const facts = liveFactsOf(
      {
        policy,
        gossip: {
          view: { members: [a, b, c], overCap: [], revoked: [] },
          self: a.signPub,
          lastSync: () => undefined,
          owedCount: () => 0,
        },
        reconciler: { lines: () => [{ machine, hostId: b.hostId }] },
      },
      clock,
    );
    expect([...facts.lines.entries()]).toEqual([
      [b.signPub, { state: "unreachable", reason: "no route", stuck: null, helloCoreId: "core-b", replaced: null }],
    ]);
  });
});
