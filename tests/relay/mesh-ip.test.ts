import { afterAll, beforeAll, expect, test } from "bun:test";
import { untilGone } from "./support/mesh/gone.ts";
import { type Mesh, startMesh, TEARDOWN_MS } from "./support/mesh/mesh.ts";
import { RESTART_BUDGET_MS } from "./support/mesh/relay-front.ts";
import { scenario } from "./support/mesh/present.ts";
import { statusOf } from "./support/mesh/status.ts";
import { inOrder } from "./support/sequential.ts";

const NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
/** Inviter of each joiner, spread so no single host carries every join. */
const JOINS = [
  ["a", "b"],
  ["a", "c"],
  ["b", "d"],
  ["c", "e"],
  ["d", "f"],
  ["e", "g"],
  ["f", "h"],
] as const;
/**
 * Design 8.2's bound above five members: the last joiner's machines land after up to 120 s (two more budget windows of
 * its own 12 upgrades per 60 s) plus T_add (20 s). The budget is per host; nothing in it depends on the address.
 */
const CONVERGE_MS = 120_000 + 20_000;
/**
 * Design 8.2: after a relay restart every line is back within 120 s in general (60 s when uplinks return in 5 s),
 * counted from the moment the relay answers again; its own stop and start under wrangler dev are the harness's.
 * Measured from that moment over 22 runs on two loaded Linux runners (load 28-109, one inside the whole relay suite;
 * #166): median 61.3 s, max 93.7 s, every run within the design's 120 s. The bound is twice that max, so a runner twice as slow still passes and a
 * restart whose lines never return still fails.
 */
const MEASURED_RECOVERY_MAX_MS = 93_663;
const RECOVER_MS = 2 * MEASURED_RECOVERY_MAX_MS;
const RATE_LIMITED = 4429;
/** The old per-address limit: 60 upgrades per wall-clock minute (a fixed window, `Math.floor(now / 60 s)`). */
const MINUTE_MS = 60_000;
const OLD_LIMIT = 60;
const REMAINING = ["a", "b", "c", "d", "e", "f", "g"] as const;
let mesh: Mesh | undefined;

const running = (): Mesh => {
  if (mesh === undefined) throw new Error("setup failed");
  return mesh;
};

/** How many close codes each host's tap had recorded: a phase asserts only the closes after its own mark. */
type Mark = readonly number[];
const markOf = (hosts: Mesh): Mark => hosts.hosts.map((host) => host.tap?.closeCodes().length ?? 0);
const closesSince = (hosts: Mesh, from: Mark): readonly number[] =>
  hosts.hosts.flatMap((host, index) => (host.tap?.closeCodes() ?? []).slice(from[index] ?? 0));

/** No socket the relay closed toward any host since `from` carried 4429. */
function expectNoRateLimit(hosts: Mesh, from: Mark): void {
  expect(closesSince(hosts, from).filter((code) => code === RATE_LIMITED)).toEqual([]);
}

/** Every named host's live dial budget is unhalved (`budget.halvedUntil` null): the full 12 dials per 60 s (8.2). */
async function expectFullBudgets(hosts: Mesh, names: readonly string[]): Promise<void> {
  const halved = await Promise.all(names.map(async (name) => [name, (await statusOf(hosts.host(name))).halvedUntil]));
  expect(halved).toEqual(names.map((name) => [name, null]));
}

/** The most proven upgrades the relay logged in one wall-clock minute, the window the old per-address limit counts. */
function peakPerMinute(times: readonly number[]): number {
  const perMinute = Map.groupBy(times, (time) => Math.floor(time / MINUTE_MS));
  return Math.max(0, ...[...perMinute.values()].map((inMinute) => inMinute.length));
}

const provenTimes = (hosts: Mesh): readonly number[] => hosts.relay?.provenAt() ?? [];

async function connectedCounts(hosts: Mesh, names: readonly string[]): Promise<readonly number[]> {
  return Promise.all(
    names.map(async (name) => {
      const { machines } = await (await hosts.core(name)).call("machine.list");
      return machines.filter((machine) => machine.state === "connected").length;
    }),
  );
}

/** Every named host lists every other as connected within `ms`; a timeout names the counts and the closes since `from`. */
async function untilConnected(hosts: Mesh, names: readonly string[], ms: number, from: Mark): Promise<void> {
  await hosts
    .until(
      `every one of ${names.length} hosts lists the other ${names.length - 1} as connected`,
      async () => (await connectedCounts(hosts, names)).every((count) => count === names.length - 1),
      ms,
    )
    .catch(async (error: unknown) => {
      const counts = JSON.stringify(await connectedCounts(hosts, names));
      const closes = JSON.stringify(closesSince(hosts, from));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; connected per host ${counts}, closes ${closes}`,
      );
    });
}

scenario("E-IP (any number of hosts behind one address, #119)", ["join", "revoke", "sync", "wire"], () => {
  beforeAll(async () => {
    const started = await startMesh({ names: NAMES });
    mesh = started;
    await inOrder(JOINS, ([inviter, joiner]) => started.join(inviter, joiner));
  }, 900_000);

  afterAll(async () => {
    const receipt = await mesh?.dispose();
    expect([receipt?.alive, receipt?.listening]).toEqual([[], []]);
  }, TEARDOWN_MS);

  test(
    "E-IP: eight hosts behind one source IP all join and converge with no 4429 at any host",
    async () => {
      const hosts = running();
      const start = hosts.hosts.map(() => 0);
      expect(new Set(hosts.hosts.map((host) => host.tap?.ip)).size).toBe(1);
      await untilConnected(hosts, NAMES, CONVERGE_MS, start);
      expectNoRateLimit(hosts, start);
      await expectFullBudgets(hosts, NAMES);
      expect(peakPerMinute(provenTimes(hosts))).toBeGreaterThan(OLD_LIMIT);
    },
    CONVERGE_MS + 60_000,
  );

  test("E-IP: a --compromised revoke converges everywhere, with no 4429 during it", async () => {
    const hosts = running();
    const from = markOf(hosts);
    expect((await hosts.host("a").cli("mesh", "revoke", "--compromised", "h", "--yes")).exit).toBe(0);
    await untilGone(hosts, REMAINING, ["h"]);
    expectNoRateLimit(hosts, from);
    await expectFullBudgets(hosts, REMAINING);
  }, 180_000);

  test(
    "E-IP: after a relay restart every remaining line is back within the bound, with no 4429 during it",
    async () => {
      const hosts = running();
      const relay = hosts.relay;
      if (relay === undefined) throw new Error("E-IP needs the local relay");
      const from = markOf(hosts);
      const stopped = performance.now();
      await relay.restart();
      const answered = performance.now();
      await untilConnected(hosts, REMAINING, RECOVER_MS, from);
      const back = performance.now();
      console.log(
        `E-IP restart: the relay answered ${Math.round(answered - stopped)} ms after its stop began; ` +
          `every line was back ${Math.round(back - answered)} ms after that`,
      );
      expectNoRateLimit(hosts, from);
      await expectFullBudgets(hosts, REMAINING);
    },
    RESTART_BUDGET_MS + RECOVER_MS + 60_000,
  );
});
