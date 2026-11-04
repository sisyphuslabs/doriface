import { afterAll, beforeAll, expect, test } from "bun:test";
import { base64urlEncode, generateX25519 } from "@doriface/crypto";
import { dialAs, type Dialed, refusalCodes } from "./support/mesh/dial.ts";
import { deviceKeys, seedDevices } from "./support/mesh/devices.ts";
import { untilFullMesh } from "./support/mesh/echo.ts";
import { untilGone } from "./support/mesh/gone.ts";
import { holdLine } from "./support/mesh/held-line.ts";
import { identityOf } from "./support/mesh/identity.ts";
import { type Mesh, startMesh, TEARDOWN_MS } from "./support/mesh/mesh.ts";
import { scenario } from "./support/mesh/present.ts";
import { machineIds } from "./support/mesh/status.ts";
import { within } from "./support/watch.ts";

/**
 * Four hosts behind the harness's one IP, within section 8.2's per-IP arithmetic: the revoker a, a watcher b, the
 * member c, and d, which c admitted.
 */
const NAMES = ["a", "b", "c", "d"] as const;
const REFUSED = 4401;
const CLOSE_MS = 60_000;
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
  "E-REVOKE --compromised (a member and everyone it admitted, everywhere)",
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
    }, TEARDOWN_MS);

    test("E-REVOKE --compromised c: c and d go everywhere, with their sessions (4401), lines and device entries", async () => {
      const hosts = running();
      const watchers = ["a", "b"];
      const revoked = ["c", "d"];
      const unrelated = generateX25519().publicKey;
      for (const name of watchers) {
        seedDevices(hosts.host(name), [
          ...revoked.map((who) => ({ key: identityOf(hosts.host(who)).noise.publicKey, name: `old-${who}` })),
          { key: unrelated, name: "phone" },
        ]);
      }
      const sessions: readonly Dialed[] = await Promise.all(
        revoked.flatMap((who) => watchers.map((name) => dialAs(hosts, identityOf(hosts.host(who)), hosts.host(name)))),
      );
      expect(sessions.map((session) => session.kind)).toEqual(sessions.map(() => "open"));
      const lines = await Promise.all(
        watchers.flatMap((name) => revoked.map((who) => holdLine(hosts.host(name), hosts.host(who)))),
      );
      expect(lines.map((line) => line.isOpen())).toEqual(lines.map(() => true));

      expect((await hosts.host("a").cli("mesh", "revoke", "--compromised", "c", "--yes")).exit).toBe(0);
      await untilGone(hosts, watchers, revoked);
      const closes = sessions.map((session) => (session.kind === "open" ? session.closed : Promise.resolve(-1)));
      expect(await within(Promise.all(closes), "the revoked members' sessions closing", CLOSE_MS)).toEqual(
        closes.map(() => REFUSED),
      );
      await within(Promise.all(lines.map((line) => line.closed)), "the watchers' outbound lines closing", CLOSE_MS);
      const kept = [base64urlEncode(unrelated)];
      await hosts.until("device entries of c and d removed on a and b (6.7)", () =>
        watchers.every((name) => JSON.stringify(deviceKeys(hosts.host(name))) === JSON.stringify(kept)),
      );
      await Promise.all(revoked.map((who) => refusedBy(hosts, who, watchers)));
      await hosts.until("c and d remove their own mesh machines (6.4)", async () =>
        (await Promise.all(revoked.map((name) => machineIds(hosts, name)))).every((ids) => ids.length === 0),
      );
    }, 240_000);
  },
);
