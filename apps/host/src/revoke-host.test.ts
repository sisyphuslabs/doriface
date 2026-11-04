import { expect, test } from "bun:test";
import { rawStaticKey } from "@doriface/crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { startHost } from "./host.ts";
import { headsOfRecords, meshIdOfRecords, peer, Signer } from "./mesh/testing/mesh-peers.ts";
import { loadHostIdentity } from "./state/host-keys.ts";
import { MeshStore } from "./state/mesh.ts";
import { openE2eeClient } from "./testing/e2ee-client.ts";
import { createHcSession } from "./testing/hc-session.ts";
import { machine, MeshFixture } from "./testing/mesh-history.ts";

const line = (value: object): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

/** b's state dir holding its own keys and a mesh of a, b and c that a founded. */
function memberB() {
  const stateDir = mkdtempSync(join(tmpdir(), "dh-revoke-host-"));
  const identity = loadHostIdentity(stateDir);
  const [a, c] = [peer("a"), peer("c")];
  const fixture = new MeshFixture(mkdtempSync(join(stateDir, "founder-")), a.machine);
  fixture.admit(a.machine, { ...machine("b"), identity });
  fixture.admit(a.machine, c.machine);
  const records = fixture.store.read()?.records ?? [];
  if (!new MeshStore(stateDir, { log: () => undefined }).adopt(records, identity)) throw new Error("b is in a mesh");
  return { stateDir, identity, a, c, records };
}

test("the running host closes a member's live session 4401 when a peer's sync brings that member's revoke (6.3)", async () => {
  const { stateDir, identity, a, c, records } = memberB();
  const hc = createHcSession("revoke-host");
  const host = await startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: generateToken(),
    hc: hc.hc,
    session: hc.name,
    env: hc.env,
    stateDir,
    log: () => undefined,
  });
  try {
    const url = host.e2ee?.url ?? "";
    const to = { hostId: identity.hostId, remoteStatic: identity.noise.publicKey };
    const fromC = await openE2eeClient(url, { ...to, staticKey: rawStaticKey(c.machine.identity.noise) });
    const fromA = await openE2eeClient(url, {
      ...to,
      staticKey: rawStaticKey(a.machine.identity.noise),
      stream: "mesh",
    });
    const mesh = meshIdOfRecords(records);
    const heads = headsOfRecords(records);
    fromA.link.send(line({ t: "hello", v: 2, mesh, heads, n: {} }));
    fromA.link.send(line({ t: "records", records: [new Signer(a, records).revoke(heads, c)] }));
    fromA.link.send(line({ t: "done", mesh }));
    const bound = Bun.sleep(10_000).then(() => "still open after 10 s");
    expect(await Promise.race([fromC.closed, bound])).toBe(4401);
  } finally {
    await host.stop();
    await hc.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  }
}, 30_000);
