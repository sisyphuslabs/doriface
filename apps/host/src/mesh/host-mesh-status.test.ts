import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519 } from "@doriface/crypto";
import { parseMeshStatus } from "@doriface/protocol";
import { generateToken } from "../auth.ts";
import { requestControl } from "../control.ts";
import { type Host, startHost } from "../host.ts";
import { loadHostIdentity } from "../state/host-keys.ts";
import { createHcSession, type HcSession } from "../testing/hc-session.ts";
import { type Machine, machine, MeshFixture } from "../testing/mesh-history.ts";

const dirs: string[] = [];
/** Each host's start, held from the call: a test that times out mid-start still stops the host that comes up later. */
const hosts: Promise<Host | undefined>[] = [];
const sessions: HcSession[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(async (started) => (await started)?.stop()));
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host on its own scratch core: reading its core id would otherwise start the default session's core and leave it. */
async function hostIn(dir: string): Promise<Host> {
  const session = createHcSession("host-mesh");
  sessions.push(session);
  // A start the test outlives would bring this session's core back after its dispose, with nothing to stop it.
  const started = startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: generateToken(),
    hc: session.hc,
    session: session.name,
    env: session.env,
    stateDir: dir,
    log: () => {},
  });
  hosts.push(started.catch(() => undefined));
  return started;
}

function meshHere(): { dir: string; self: Machine; mesh: MeshFixture } {
  const dir = mkdtempSync(join(tmpdir(), "dh-host-mesh-"));
  dirs.push(dir);
  const self = { identity: loadHostIdentity(dir), device: generateX25519(), name: "studio", hcId: "core-studio" };
  return { dir, self, mesh: new MeshFixture(dir, self) };
}

const statusOf = async (dir: string) => parseMeshStatus(await requestControl(dir, { op: "mesh-status" }));

describe("the running host answers mesh status from its mesh.json", () => {
  test("a host with no mesh still answers null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-host-mesh-"));
    dirs.push(dir);
    await hostIn(dir);
    expect(await requestControl(dir, { op: "mesh-status" })).toBeNull();
  });

  test("a member's status lists itself and the members its view holds", async () => {
    const { dir, self, mesh } = meshHere();
    const laptop = machine("laptop");
    mesh.admit(self, laptop);
    await hostIn(dir);
    const status = await statusOf(dir);
    expect(status?.meshId).toBe(mesh.meshId);
    expect(status?.self).toBe(self.identity.hostId);
    expect(status?.members.map((member) => [member.name, member.line, member.admittedBy])).toEqual([
      ["studio", "self", null],
      ["laptop", "absent", self.identity.hostId],
    ]);
  });

  test("a revoke and a rename through the control socket show in the next status", async () => {
    const { dir, self, mesh } = meshHere();
    const [laptop, tablet] = [machine("laptop"), machine("tablet")];
    mesh.admit(self, laptop);
    mesh.admit(self, tablet);
    mesh.record(laptop, "ack");
    mesh.store.catchUp(self.identity);
    await hostIn(dir);
    await requestControl(dir, { op: "mesh-rename", member: "tablet", name: "pad" });
    const reply = await requestControl(dir, { op: "mesh-revoke", member: "laptop", compromised: false, yes: true });
    expect(reply).toMatchObject({ written: true });
    const status = await statusOf(dir);
    expect(status?.members.map((member) => member.name)).toEqual(["studio", "pad"]);
    expect(status?.revoked.map((member) => [member.name, member.reason, member.revokedBy])).toEqual([
      ["laptop", "revoke", [self.identity.hostId]],
    ]);
  });
});
