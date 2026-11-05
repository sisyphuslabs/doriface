import { describe, expect, test } from "bun:test";
import type { ByteLink } from "@doriface/crypto";
import { viewOf } from "@doriface/mesh";
import { HcRpcError, type Machine, type MachineView } from "@doriface/protocol";
import { ADD_UPGRADES, DIAL_LIMITS, DialPolicy, type DialPurpose, type Grant } from "./dial-policy.ts";
import { MeshDriver } from "./driver.ts";
import type { HcMachines } from "./hc-machines.ts";
import { ADD_RESERVATION_MS, LineGrants } from "./line-grants.ts";
import { meshViewOf } from "./mesh-view.ts";
import { Reconciler } from "./reconciler.ts";
import { FakeClock, seededRandom, settle } from "./testing/fake-clock.ts";
import { meshOf, peer } from "./testing/mesh-peers.ts";
import { meshHostOf } from "./via.ts";

const PROGRAM = "/opt/doriface-host";
const STATE = "/state";
const quiet = (): void => undefined;
const idle: ByteLink = {
  send: () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  close: () => undefined,
};

/** A dial policy that counts the relay upgrades it charges (a direct dial is not charged). */
class CountingPolicy extends DialPolicy {
  charged = 0;

  override async acquire(member: string, purpose: DialPurpose, options: { direct?: boolean; waitMs?: number } = {}) {
    const grant: Grant = await super.acquire(member, purpose, options);
    if (grant.ok && grant.chargedAt !== undefined) this.charged += 1;
    return grant;
  }

  override async acquireAdd(member: string) {
    const grant: Grant = await super.acquireAdd(member);
    if (grant.ok) this.charged += ADD_UPGRADES;
    return grant;
  }
}

/**
 * Section 8.2's join on the real policy, line grants, reconciler and driver (#106, M-E3): a newcomer to a mesh of N
 * members dials its inviter to pair, pushes its admission ack to the N - 2 others, then has herdr add the N - 1 other
 * members, each through two line grants (herdr's hello probe, then the line), as `machine.add` does.
 */
async function join(members: number) {
  const names = "abcdefghijkl".slice(0, members).split("");
  const { records } = meshOf(names.map(peer));
  const view = meshViewOf(records, viewOf(records));
  const clock = new FakeClock();
  let driver: MeshDriver | undefined;
  const policy = new CountingPolicy({ clock, random: seededRandom(members), onDue: (m, r) => void driver?.due(m, r) });
  const lines = new LineGrants({ view: () => view, policy, dial: () => Promise.resolve(idle), clock });
  const table: MachineView[] = [];
  const addedAt: number[] = [];
  const grant = async (via: string): Promise<void> => {
    const granted = await lines.grant(meshHostOf(via, PROGRAM, STATE) ?? "");
    if (!granted.ok) {
      const message = `doriface-host connect: ${granted.reason}`;
      throw new HcRpcError({ code: -32000, message, data: { kind: "unreachable" } });
    }
  };
  const machines: HcMachines = {
    list: () => Promise.resolve([...table]),
    rm: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    connect: () => Promise.reject(new HcRpcError({ code: -32000, message: "no", data: { kind: "not_found" } })),
    add: async (name, via): Promise<Machine> => {
      await grant(via);
      await grant(via);
      const machine = { host: name, id: `core-${name}`, name, target: via, version: "0" };
      table.push({ ...machine, state: "connected", via: true });
      addedAt.push(clock.now());
      return machine;
    },
  };
  const [newcomer, inviter, ...others] = names.map(peer);
  if (newcomer === undefined || inviter === undefined) throw new Error("a join needs two members");
  const reconciler = new Reconciler({
    machines,
    program: PROGRAM,
    stateDir: STATE,
    selfHostId: newcomer.hostId,
    clock,
    log: quiet,
    reserve: (hostId) => lines.reserveAdd(hostId),
  });
  driver = new MeshDriver({ reconciler, lines, policy, view });
  await policy.acquire(inviter.signPub, "push");
  await Promise.all(others.map((member) => policy.acquire(member.signPub, "push")));
  void driver.start();
  await settle();
  const windows = Math.ceil((3 * members - 3) / DIAL_LIMITS.budget);
  await clock.advanceTimers(windows * DIAL_LIMITS.windowMs);
  return { charged: policy.charged, added: table.length, lastAddAt: Math.max(...addedAt), windows };
}

describe("the join bound per mesh size (section 8.2, #106 M-E3)", () => {
  test.each([
    [5, 1],
    [6, 2],
    [7, 2],
    [12, 3],
  ])(
    "a newcomer to %i members charges 3N - 3 relay upgrades and every add lands within %i window(s) of 60 s",
    async (members, windows) => {
      const joined = await join(members);
      expect(joined.windows).toBe(windows);
      expect(joined.added).toBe(members - 1);
      expect(joined.charged).toBe(3 * members - 3);
      expect(joined.lastAddAt).toBeLessThan(windows * DIAL_LIMITS.windowMs);
    },
  );
});

function reservations() {
  const { records } = meshOf("abc".split("").map(peer));
  const view = meshViewOf(records, viewOf(records));
  const clock = new FakeClock();
  const due: string[] = [];
  const policy = new DialPolicy({
    clock,
    random: seededRandom(3),
    onDue: (member, reason) => void due.push(`${clock.now()} ${member} ${reason}`),
  });
  const lines = new LineGrants({ view: () => view, policy, dial: () => Promise.resolve(idle), clock });
  const member = peer("b");
  return { clock, due, policy, lines, member };
}

const takeTokens = async (policy: DialPolicy, count: number): Promise<void> =>
  void (await Promise.all(Array.from({ length: count }, (_, i) => policy.acquire(`other-${i}`, "push"))));

describe("an add's reserved upgrades (section 8.2, #106 M-E3)", () => {
  test("herdr's line dial after machine.add returns spends the add's second reserved upgrade, not a new token", async () => {
    const { clock, policy, lines, member } = reservations();
    await takeTokens(policy, DIAL_LIMITS.budget - 2);
    expect((await lines.reserveAdd(member.hostId)).ok).toBe(true);
    expect((await lines.grant(member.hostId)).ok).toBe(true);
    await clock.advanceTimers(2_000);
    const line = lines.grant(member.hostId);
    await settle();
    expect((await line).ok).toBe(true);
  });

  test("a reservation whose line never comes times out and gives its undialed token back, so the next grant takes it at once", async () => {
    const { clock, policy, lines, member } = reservations();
    await takeTokens(policy, DIAL_LIMITS.budget - 2);
    expect((await lines.reserveAdd(member.hostId)).ok).toBe(true);
    expect((await lines.grant(member.hostId)).ok).toBe(true);
    await clock.advanceTimers(ADD_RESERVATION_MS);
    expect((await lines.grant(member.hostId)).ok).toBe(true);
    const full = lines.grant(member.hostId);
    await clock.advanceTimers(DIAL_LIMITS.lineWaitMs);
    expect(await full).toMatchObject({ ok: false, code: 4429 });
  });

  test("a reservation the window has no room for within the line wait spends nothing, and the member is due once both upgrades fit", async () => {
    const { clock, due, policy, lines, member } = reservations();
    await takeTokens(policy, DIAL_LIMITS.budget - 1);
    const reserved = lines.reserveAdd(member.hostId);
    await clock.advanceTimers(DIAL_LIMITS.lineWaitMs);
    expect(await reserved).toMatchObject({ ok: false, code: 4429 });
    const last = await policy.acquire("late", "push");
    expect(last.ok && last.chargedAt).toBe(DIAL_LIMITS.lineWaitMs);
    await clock.advanceTimers(DIAL_LIMITS.windowMs);
    expect(due).toEqual([`${DIAL_LIMITS.windowMs} ${member.signPub} budget`]);
  });
});
