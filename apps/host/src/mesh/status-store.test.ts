import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashOf, signRecord, ViewCache, viewOf } from "@doriface/mesh";
import { parseMeshStatus } from "@doriface/protocol";
import { machine, MeshFixture, signPubOf } from "../testing/mesh-history.ts";
import { planRevoke } from "./revoke-plan.ts";
import { IDLE_MESH_HOOKS } from "./host-hooks.ts";
import { meshStatus } from "./status.ts";
import { meshSourcesOf, storedMeshStatus } from "./status-store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A view cache that counts the engines built through it: a callee that builds its own engine adds none. */
class CountingCache extends ViewCache {
  engines = 0;
  override engineFor(records: Parameters<ViewCache["engineFor"]>[0]) {
    this.engines++;
    return super.engineFor(records);
  }
}

describe("mesh status and the revoke plan build every engine through the call's view cache", () => {
  test("one cache serves the view, every member's witness pool and the plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-status-cache-"));
    dirs.push(dir);
    const f = machine("f");
    const mesh = new MeshFixture(dir, f);
    const others = ["a", "b", "c", "d"].map(machine);
    for (const other of others) mesh.admit(f, other);
    for (const other of others) mesh.record(other, "ack");
    const file = mesh.store.read();
    if (file === undefined) throw new Error("no mesh");
    const cache = new CountingCache();
    const view = viewOf(file.records, cache);
    cache.engines = 0;
    const self = signPubOf(f);
    meshStatus(meshSourcesOf(file, view, self, IDLE_MESH_HOOKS.live(), cache), new Date());
    expect(cache.engines).toBeGreaterThan(0);
    cache.engines = 0;
    planRevoke(file.records, view, self, "a", true, cache);
    expect(cache.engines).toBeGreaterThan(0);
  });
});

function meshAtF() {
  const dir = mkdtempSync(join(tmpdir(), "dh-status-read-"));
  dirs.push(dir);
  const f = machine("f"),
    a = machine("a"),
    b = machine("b");
  const mesh = new MeshFixture(dir, f);
  mesh.admit(f, a);
  mesh.admit(f, b);
  return { f, a, b, mesh };
}
const readable = (status: unknown) => parseMeshStatus(JSON.parse(JSON.stringify(status)));

describe("the stored status is always one the status parser reads (contract v1.5 mesh status)", () => {
  test("a revoke whose display time is not an ISO instant shows no time instead of an unreadable status", () => {
    const { f, b, mesh } = meshAtF();
    const body = { ...mesh.next(f, "revoke", { signPubs: [signPubOf(b)], reason: "revoke" }), at: "yesterday" };
    mesh.store.merge([signRecord(body, f.identity.sign.secretKey)]);
    const status = readable(storedMeshStatus(mesh.store, f.identity, IDLE_MESH_HOOKS));
    expect(status?.revoked.map((entry) => entry.at)).toEqual([null]);
  });

  test("a host its own view no longer holds lists only its view's members, and says it is possibly revoked", () => {
    const { f, a, b, mesh } = meshAtF();
    mesh.revoke(a, f);
    const status = readable(storedMeshStatus(mesh.store, f.identity, IDLE_MESH_HOOKS));
    expect(status?.members.map((member) => member.hostId).toSorted()).toEqual(
      [a.identity.hostId, b.identity.hostId].toSorted(),
    );
    expect(status?.stuck).toContainEqual({ kind: "possibly_revoked" });
  });
});

/** f admits x then y, neither acks, f revokes both in one record; x and y then backdate revokes from their admissions. */
function twoCulprits(yNamesX: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "dh-status-two-culprits-"));
  dirs.push(dir);
  const f = machine("f"),
    x = machine("x"),
    y = machine("y");
  const mesh = new MeshFixture(dir, f);
  const xAdmitted = mesh.admit(f, x);
  const yAdmitted = mesh.admit(f, y);
  mesh.revoke(f, x, y);
  const backdate = (by: typeof x, after: typeof xAdmitted, subjects: readonly (typeof x)[]) =>
    signRecord(
      {
        v: 2,
        mesh: mesh.meshId,
        type: "revoke",
        by: signPubOf(by),
        n: 1,
        prev: [hashOf(after)],
        subject: { signPubs: subjects.map(signPubOf), reason: "revoke" },
      },
      by.identity.sign.secretKey,
    );
  mesh.store.merge([backdate(x, xAdmitted, [f]), backdate(y, yAdmitted, yNamesX ? [f, x] : [f])]);
  const status = readable(storedMeshStatus(mesh.store, f.identity, IDLE_MESH_HOOKS));
  return { f, x, y, status };
}

describe("design 3.7: a host removed by an undecidable revoke says so", () => {
  test("N = 2: f revokes a, and a's backdated revoke of f stands 0:0; f's status names a and stays readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-status-fail-closed-"));
    dirs.push(dir);
    const f = machine("f"),
      a = machine("a");
    const mesh = new MeshFixture(dir, f);
    const admitted = mesh.admit(f, a);
    mesh.revoke(f, a);
    const backdated = signRecord(
      {
        v: 2,
        mesh: mesh.meshId,
        type: "revoke",
        by: signPubOf(a),
        n: 1,
        prev: [hashOf(admitted)],
        subject: { signPubs: [signPubOf(f)], reason: "revoke" },
      },
      a.identity.sign.secretKey,
    );
    mesh.store.merge([backdated]);
    const status = readable(storedMeshStatus(mesh.store, f.identity, IDLE_MESH_HOOKS));
    expect(status?.stuck).toContainEqual({ kind: "removed_undecidable" });
    expect(status?.removed).toEqual([
      { members: [{ hostId: f.identity.hostId, name: "f" }], revokedKey: { hostId: a.identity.hostId, name: "a" } },
    ]);
  });

  test.each([
    ["y names f only", false],
    ["y names f and x", true],
  ])("two revoked keys each remove f at 0:0 (%s): both are named, and f is removed by each", (_, yNamesX) => {
    const { f, x, y, status } = twoCulprits(yNamesX);
    expect(status?.stuck).toContainEqual({ kind: "removed_undecidable" });
    const culprits = (status?.removed ?? []).filter((fact) => fact.members.some((m) => m.hostId === f.identity.hostId));
    expect(culprits.map((fact) => fact.revokedKey.hostId).toSorted()).toEqual(
      [x.identity.hostId, y.identity.hostId].toSorted(),
    );
    expect((status?.removed ?? []).some((fact) => fact.revokedKey.hostId === f.identity.hostId)).toBe(false);
  });
});
