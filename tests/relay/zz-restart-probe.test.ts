import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Mesh, startMesh, TEARDOWN_MS } from "./support/mesh/mesh.ts";
import { scenario } from "./support/mesh/present.ts";

// Probe for #379, never merged: what ten relay restarts do to each host's uplink.
const NAMES = ["a", "b", "c"] as const;
const RESTARTS = 10;
let mesh: Mesh | undefined;

async function allConnected(hosts: Mesh): Promise<boolean> {
  const counts = await Promise.all(
    NAMES.map(async (name) => {
      const { machines } = await (await hosts.core(name)).call("machine.list");
      return machines.filter((machine) => machine.state === "connected").length;
    }),
  );
  return counts.every((count) => count === NAMES.length - 1);
}

scenario("probe #379: what a relay restart does to each uplink", ["join", "sync", "wire"], () => {
  beforeAll(async () => {
    mesh = await startMesh({ names: NAMES });
    await mesh.join("a", "b");
    await mesh.join("a", "c");
  }, 600_000);

  afterAll(async () => {
    await mesh?.dispose();
  }, TEARDOWN_MS);

  test(
    "ten restarts",
    async () => {
      const hosts = mesh;
      if (hosts?.relay === undefined) throw new Error("needs the local relay");
      await hosts.until("all connected", () => allConnected(hosts), 200_000);
      for (let restart = 1; restart <= RESTARTS; restart += 1) {
        const from = NAMES.map((name) => hosts.host(name).tap?.uplinkEnds().length ?? 0);
        const closesFrom = NAMES.map((name) => hosts.host(name).tap?.closeCodes().length ?? 0);
        await hosts.relay.restart();
        const answered = performance.now();
        await hosts.until("all connected", () => allConnected(hosts), 200_000);
        const ends = Object.fromEntries(
          NAMES.map((name, index) => [name, hosts.host(name).tap?.uplinkEnds().slice(from[index]) ?? []]),
        );
        const closes = Object.fromEntries(
          NAMES.map((name, index) => [name, hosts.host(name).tap?.closeCodes().slice(closesFrom[index]) ?? []]),
        );
        const recoveryMs = Math.round(performance.now() - answered);
        console.log(
          `RESTART_PROBE ${JSON.stringify({ restart, uplinkEnds: ends, allCloseCodes: closes, recoveryMs })}`,
        );
      }
      expect(true).toBe(true);
    },
    RESTARTS * 330_000,
  );
});
