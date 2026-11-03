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
import { resolveHcBin } from "../testing/hc-session.ts";
import { type Machine, machine, MeshFixture } from "../testing/mesh-history.ts";

const dirs: string[] = [];
const hosts: Host[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function hostIn(dir: string): Promise<Host> {
  const host = await startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: generateToken(),
    hc: resolveHcBin(),
    stateDir: dir,
    log: () => {},
  });
  hosts.push(host);
  return host;
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
