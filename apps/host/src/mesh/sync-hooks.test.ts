import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewOf } from "@doriface/mesh";
import { MeshCommands } from "./commands.ts";
import { syncHooks } from "./sync-hooks.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { MeshNet } from "./testing/mesh-net.ts";
import { meshOf, peer } from "./testing/mesh-peers.ts";

/** a, b and c on one in-memory relay; `MeshCommands` on a, its pushes and confirmations through a's own gossip. */
function threeMembers() {
  const [a, b, c] = [peer("a"), peer("b"), peer("c")];
  const clock = new FakeClock();
  const net = new MeshNet(clock, seededRandom(78));
  const { records } = meshOf([a, b, c]);
  const [atA, atB, atC] = [a, b, c].map((member) => net.add(member, records));
  if (atA === undefined || atB === undefined || atC === undefined) throw new Error("no hosts");
  const sync = { gossip: atA.gossip, runtime: undefined, changed: () => undefined, stop: () => atA.gossip.stop() };
  const stateDir = mkdtempSync(join(tmpdir(), "dh-sync-hooks-"));
  const commands = new MeshCommands({
    store: atA.store,
    stateDir,
    identity: a.machine.identity,
    closeRevoked: () => undefined,
    hooks: syncHooks(sync, clock),
    log: () => undefined,
  });
  const cleanup = () => rmSync(stateDir, { recursive: true, force: true });
  return { a, b, c, clock, net, atB, atC, commands, cleanup };
}

/** Runs `work` while virtual time advances, until it settles; returns its value and the virtual time it took. */
async function underClock<T>(clock: FakeClock, work: Promise<T>, limitMs: number) {
  let done: { value: T } | undefined;
  void work.then((value) => {
    done = { value };
    return value;
  });
  const took = await clock.until(() => done !== undefined, limitMs);
  if (done === undefined) throw new Error("work did not settle");
  return { value: done.value, took };
}

describe("mesh revoke, rename and leave reach the other members through sync (design 5.3, 6.2, 6.5)", () => {
  test("a rename and a revoke written on a reach b's and c's stores", async () => {
    const { b, c, clock, atB, atC, commands, cleanup } = threeMembers();
    try {
      await commands.rename({ member: "b", name: "b2" });
      await clock.until(() => viewOf(atC.records()).name.get(b.signPub) === "b2", 60_000);
      await commands.revoke({ member: "c", compromised: false, yes: true });
      await clock.until(() => viewOf(atB.records()).revoked.has(c.signPub), 60_000);
    } finally {
      cleanup();
    }
  });

  test("leave reports the members that confirmed its self-revoke", async () => {
    const { b, c, clock, commands, cleanup } = threeMembers();
    try {
      const { value } = await underClock(clock, commands.leave(), 40_000);
      expect(value?.confirmed.map((member) => member.hostId).toSorted()).toEqual([b.hostId, c.hostId].toSorted());
      expect(value?.revokeCommand).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("an offline member does not confirm, and leave stops waiting at 30 s", async () => {
    const { b, clock, net, commands, cleanup } = threeMembers();
    try {
      net.offline("c");
      const { value, took } = await underClock(clock, commands.leave(), 40_000);
      expect(value?.confirmed.map((member) => member.hostId)).toEqual([b.hostId]);
      expect(took).toBeGreaterThanOrEqual(30_000);
    } finally {
      cleanup();
    }
  });

  test("with every member offline, leave confirms none and prints the revoke to run elsewhere", async () => {
    const { clock, net, commands, cleanup } = threeMembers();
    try {
      net.offline("b");
      net.offline("c");
      const { value } = await underClock(clock, commands.leave(), 40_000);
      expect(value?.confirmed).toEqual([]);
      expect(value?.revokeCommand).toBe("doriface-host mesh revoke a");
    } finally {
      cleanup();
    }
  });
});

describe("mesh leave removes this host's mesh machines (design 6.5)", () => {
  test("sync stops gossiping first, then the reconciler removes every mesh machine, then sync stops", async () => {
    const calls: string[] = [];
    const runtime = {
      gossip: { stop: () => void calls.push("gossip stopped") },
      reconciler: {
        reconcile: (view: { readonly members: readonly unknown[]; readonly overCap: readonly unknown[] }) => {
          calls.push(`reconciled to ${view.members.length + view.overCap.length} members`);
          return Promise.resolve();
        },
      },
    };
    const sync = {
      gossip: undefined,
      runtime,
      changed: () => undefined,
      stop: () => {
        calls.push("sync stopped");
        return Promise.resolve();
      },
    };
    await syncHooks(sync, new FakeClock()).left();
    expect(calls).toEqual(["gossip stopped", "reconciled to 0 members", "sync stopped"]);
  });
});
