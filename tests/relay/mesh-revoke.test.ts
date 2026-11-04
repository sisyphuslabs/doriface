import { afterAll, beforeAll, expect, test } from "bun:test";
import { dialAs, refusalCodes } from "./support/mesh/dial.ts";
import { untilFullMesh } from "./support/mesh/echo.ts";
import { watchForbidden } from "./support/mesh/forbidden-watch.ts";
import { untilGone } from "./support/mesh/gone.ts";
import { identityOf, mintIdentity } from "./support/mesh/identity.ts";
import { type Mesh, startMesh } from "./support/mesh/mesh.ts";
import { scenario } from "./support/mesh/present.ts";
import { machineIds, meshFileOf } from "./support/mesh/status.ts";

/** Four hosts behind the harness's one IP, within section 8.2's per-IP arithmetic. */
const NAMES = ["a", "b", "c", "d"] as const;
const REFUSED = 4401;
let mesh: Mesh | undefined;

const running = (): Mesh => {
  if (mesh === undefined) throw new Error("setup failed");
  return mesh;
};

async function refusedBy(hosts: Mesh, who: string, targets: readonly string[]): Promise<void> {
  const keys = identityOf(hosts.host(who));
  const dialed = await Promise.all(targets.map((target) => dialAs(hosts, keys, hosts.host(target))));
  expect(refusalCodes(dialed)).toEqual(targets.map(() => REFUSED));
}

scenario(
  "E-OUT and E-REVOKE (outsiders refused, a revoke everywhere)",
  ["join", "status", "revoke", "bridge", "reconciler", "wire", "sync"],
  () => {
    beforeAll(async () => {
      mesh = await startMesh({ names: NAMES });
      await mesh.join("a", "b");
      await mesh.join("a", "c");
      await mesh.join("c", "d");
      await untilFullMesh(mesh, NAMES);
    }, 300_000);

    afterAll(async () => {
      const receipt = await mesh?.dispose();
      expect([receipt?.alive, receipt?.listening]).toEqual([[], []]);
    });

    test("E-OUT: an outsider's mesh-stream and hc dials get 4401 from every member, and leave no record or machine", async () => {
      const hosts = running();
      const outsider = mintIdentity();
      const records = () => NAMES.map((name) => meshFileOf(hosts.host(name)).records.length);
      const machines = () => Promise.all(NAMES.map((name) => machineIds(hosts, name)));
      const [recordsBefore, machinesBefore] = [records(), await machines()];
      const watch = watchForbidden(hosts, NAMES, { hostIds: [outsider.hostId], coreIds: [] });
      const byStream = await Promise.all(
        (["mesh", "hc"] as const).map((stream) =>
          Promise.all(hosts.hosts.map((host) => dialAs(hosts, outsider, host, stream))),
        ),
      );
      expect(byStream.map(refusalCodes)).toEqual([NAMES.map(() => REFUSED), NAMES.map(() => REFUSED)]);
      expect(records()).toEqual(recordsBefore);
      expect(await machines()).toEqual(machinesBefore);
      expect(await watch.stop()).toEqual([]);
    }, 60_000);

    test("E-REVOKE: a revoke on a reaches every member, the revoked host is refused by all, and it drops its machines", async () => {
      const hosts = running();
      expect((await hosts.host("a").cli("mesh", "revoke", "d", "--yes")).exit).toBe(0);
      await untilGone(hosts, ["a", "b", "c"], ["d"]);
      await refusedBy(hosts, "d", ["a", "b", "c"]);
      await hosts.until(
        "d removes its own mesh machines (6.4)",
        async () => (await machineIds(hosts, "d")).length === 0,
      );
    }, 180_000);
  },
);
