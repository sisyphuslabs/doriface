import { describe, expect, test } from "bun:test";
import type { ByteLink } from "@doriface/crypto";
import { viewOf } from "@doriface/mesh";
import { HcRpcError, type Machine, type MachineView } from "@doriface/protocol";
import { DIAL_LIMITS, DialPolicy } from "./dial-policy.ts";
import { MeshDriver } from "./driver.ts";
import type { HcMachines } from "./hc-machines.ts";
import { LineGrants } from "./line-grants.ts";
import { meshViewOf } from "./mesh-view.ts";
import { Reconciler } from "./reconciler.ts";
import { FakeClock, seededRandom, settle } from "./testing/fake-clock.ts";
import { meshOf, peer } from "./testing/mesh-peers.ts";
import { meshHostOf } from "./via.ts";

const PROGRAM = "/opt/doriface-host";
const STATE = "/state";
const MINUTE = 60_000;
const quiet = (): void => undefined;
const idle: ByteLink = {
  send: () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  close: () => undefined,
};

/**
 * Section 8.2's churn model on the real policy, line grants, reconciler and driver: a 12-member mesh whose 11 other
 * members are all missing from this host's core, herdr adding each through one line grant (which waits up to 10 s for
 * a token), and the window already full when the reconciler first runs, as after a join burst.
 */
async function churn(pressure: { perMinute: number; minutes: number }, minutes: number) {
  const { records } = meshOf("abcdefghijkl".split("").map(peer));
  const view = meshViewOf(records, viewOf(records));
  const clock = new FakeClock();
  let driver: MeshDriver | undefined;
  const policy = new DialPolicy({ clock, random: seededRandom(9), onDue: (m, r) => void driver?.due(m, r) });
  const lines = new LineGrants({ view: () => view, policy, dial: () => Promise.resolve(idle) });
  const table: MachineView[] = [];
  const addsAt: number[] = [];
  const machines: HcMachines = {
    list: () => Promise.resolve([...table]),
    rm: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    connect: () => Promise.reject(new HcRpcError({ code: -32000, message: "no", data: { kind: "not_found" } })),
    add: async (name, via): Promise<Machine> => {
      addsAt.push(clock.now());
      const granted = await lines.grant(meshHostOf(via, PROGRAM, STATE) ?? "");
      if (!granted.ok) {
        const message = `doriface-host connect: ${granted.reason}`;
        throw new HcRpcError({ code: -32000, message, data: { kind: "unreachable" } });
      }
      const machine = { host: name, id: `core-${name}`, name, target: via, version: "0" };
      table.push({ ...machine, state: "connected", via: true });
      return machine;
    },
  };
  const selfHostId = peer("a").hostId;
  const reconciler = new Reconciler({ machines, program: PROGRAM, stateDir: STATE, selfHostId, clock, log: quiet });
  driver = new MeshDriver({ reconciler, lines, policy, view });
  for (let i = 0; i < DIAL_LIMITS.budget; i++) void policy.acquire(`burst-${i}`, "push");
  void driver.start();
  await settle();
  const pushAt = (k: number): number => (k * MINUTE) / pressure.perMinute;
  let pushes = 0;
  const pushing = (at: number): boolean => pressure.perMinute > 0 && at < pressure.minutes * MINUTE;
  // Goes from push to push (and then to the end), not second by second: the policy moves only by its timers, which
  // advanceTimers fires in order, so a quiet second only cost event-loop turns (#316).
  const second = async (now: number): Promise<void> => {
    if (now >= minutes * MINUTE) return;
    for (; pushing(now) && pushAt(pushes) <= now; pushes++) void policy.acquire(`push-${pushes}`, "push");
    const next = Math.min(pushing(pushAt(pushes)) ? pushAt(pushes) : minutes * MINUTE, minutes * MINUTE);
    await clock.advanceTimers(next - now);
    return second(next);
  };
  await second(0);
  return { addsAt, added: table.length };
}

const times = (count: number, at: number): number[] => Array.from({ length: count }, () => at);

describe("re-adding a line the dial budget refused (section 8.2, M-E2)", () => {
  test("after a full window and no other dial, every refused member is re-added once, the moment the window frees", async () => {
    const { addsAt, added } = await churn({ perMinute: 0, minutes: 0 }, 4);
    expect(addsAt).toEqual([...times(11, 0), ...times(11, MINUTE)]);
    expect(added).toBe(11);
  });

  test("while pushes take every token (12 a minute for 10 minutes), herdr is asked for no add, then all land", async () => {
    const { addsAt, added } = await churn({ perMinute: 12, minutes: 10 }, 13);
    expect(addsAt).toEqual([...times(11, 0), ...times(11, 11 * MINUTE)]);
    expect(added).toBe(11);
  });

  test("a token given back makes a refused line due at that moment, not when the window slides", async () => {
    const clock = new FakeClock();
    const due: string[] = [];
    const onDue = (member: string, reason: string): void => void due.push(`${clock.now()} ${member} ${reason}`);
    const policy = new DialPolicy({ clock, random: seededRandom(5), onDue });
    const [given] = await Promise.all(
      Array.from({ length: DIAL_LIMITS.budget }, (_, i) => policy.acquire(`m${i}`, "push")),
    );
    const refused = policy.acquire("late", "line", { waitMs: DIAL_LIMITS.lineWaitMs });
    await clock.advance(DIAL_LIMITS.lineWaitMs);
    expect((await refused).ok).toBe(false);
    await clock.advance(5_000);
    expect(due).toEqual([]);
    policy.release(given?.ok === true ? given.chargedAt : undefined);
    await clock.advance(0);
    expect(due).toEqual(["15000 late budget"]);
  });
});
