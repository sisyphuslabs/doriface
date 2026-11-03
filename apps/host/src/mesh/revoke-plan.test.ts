import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewOf } from "@doriface/mesh";
import { type Machine, machine, MeshFixture, signPubOf } from "../testing/mesh-history.ts";
import { planRevoke } from "./revoke-plan.ts";

function withMesh<T>(f: Machine, body: (mesh: MeshFixture) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dh-revoke-plan-"));
  try {
    return body(new MeshFixture(dir, f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function plan(mesh: MeshFixture, self: Machine, member: string, compromised = false) {
  const records = mesh.store.read()?.records ?? [];
  return planRevoke(records, viewOf(records), signPubOf(self), member, compromised);
}

const ref = (m: Machine) => ({ hostId: m.identity.hostId, name: m.name });

/** A mesh of 12 or more keys writes each record through the store, which evaluates the view per write. */
const LARGE_MESH_MS = 30_000;

/** f, a and m1..m10: twelve members, so the next admitted key is over-cap. */
function twelve(mesh: MeshFixture, f: Machine, a: Machine): readonly Machine[] {
  mesh.admit(f, a);
  const rest = Array.from({ length: 10 }, (_, i) => machine(`m${i + 1}`));
  for (const m of rest) mesh.admit(f, m);
  return rest;
}

describe("design 6.1: what mesh revoke writes and what it says first", () => {
  test("a plain revoke names one key and warns about the subtree it leaves in place", () => {
    const f = machine("f"),
      a = machine("a"),
      b = machine("b"),
      d = machine("d"),
      e = machine("e");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      mesh.admit(f, b);
      mesh.admit(a, d);
      mesh.admit(a, e);
      const p = plan(mesh, f, "a");
      expect(p.keys).toEqual([signPubOf(a)]);
      expect(p.reason).toBe("revoke");
      expect(p.subtree).toEqual([ref(d), ref(e)]);
      expect(p.undecidable).toEqual([]);
      expect(p.needsYes).toBe(false);
    });
  });

  test("--compromised names the member and its whole subtree in one record, and always asks", () => {
    const f = machine("f"),
      a = machine("a"),
      b = machine("b"),
      d = machine("d"),
      e = machine("e");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      mesh.admit(f, b);
      mesh.admit(a, d);
      mesh.admit(d, e);
      const p = plan(mesh, f, a.identity.hostId, true);
      expect(p.keys).toEqual([a, d, e].map(signPubOf));
      expect(p.reason).toBe("compromised");
      expect(p.target).toEqual(ref(a));
      expect(p.needsYes).toBe(true);
    });
  });

  test("an empty pool names the members whose position has one, and needs --yes", () => {
    const f = machine("f"),
      a = machine("a"),
      x = machine("x");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      mesh.admit(a, x);
      const p = plan(mesh, f, "a");
      expect(p.undecidable).toEqual([{ subject: ref(a), present: [ref(f)], askFrom: [ref(x)] }]);
      expect(p.needsYes).toBe(true);
    });
  });

  test("with no member to ask (N = 2) it says the mesh cannot decide, and still allows --yes", () => {
    const f = machine("f"),
      a = machine("a");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      const p = plan(mesh, f, "a");
      expect(p.undecidable).toEqual([{ subject: ref(a), present: [ref(f)], askFrom: [] }]);
      expect(p.needsYes).toBe(true);
    });
  });

  test(
    "--compromised names an over-cap key the member admitted (13 keys: f admits 11, a admits z)",
    () => {
      const f = machine("f"),
        a = machine("a"),
        z = machine("z");
      withMesh(f, (mesh) => {
        mesh.admit(f, a);
        for (let i = 1; i <= 10; i++) mesh.admit(f, machine(`m${i}`));
        mesh.admit(a, z);
        const records = mesh.store.read()?.records ?? [];
        expect(viewOf(records).overCap.has(signPubOf(z))).toBe(true);
        const p = plan(mesh, f, "a", true);
        expect(p.keys).toEqual([a, z].map(signPubOf));
        expect(p.subtree).toEqual([ref(z)]);
      });
    },
    LARGE_MESH_MS,
  );

  describe("the subtree follows each key's one admitter, its governing admission's signer (H1b)", () => {
    test(
      "C1: a second admit of an over-cap key does not make it the second admitter's lineage",
      () => {
        const f = machine("f"),
          a = machine("a"),
          z = machine("z");
        withMesh(f, (mesh) => {
          const [m1] = twelve(mesh, f, a);
          if (m1 === undefined) throw new Error("no m1");
          mesh.admit(m1, z);
          mesh.admit(a, z);
          expect(plan(mesh, f, "a", true).keys).toEqual([signPubOf(a)]);
        });
      },
      LARGE_MESH_MS,
    );

    test(
      "D1: a key revoked and re-admitted by another member leaves the first admitter's lineage",
      () => {
        const f = machine("f"),
          a = machine("a"),
          z = machine("z");
        withMesh(f, (mesh) => {
          const [m1] = twelve(mesh, f, a);
          if (m1 === undefined) throw new Error("no m1");
          mesh.admit(a, z);
          mesh.revoke(f, z);
          mesh.admit(m1, z);
          expect(plan(mesh, f, "a", true).keys).toEqual([signPubOf(a)]);
        });
      },
      LARGE_MESH_MS,
    );

    test(
      "G: a non-governing admit of a re-admitted over-cap key sweeps in neither it nor the members it admitted",
      () => {
        const f = machine("f"),
          a = machine("a"),
          b = machine("b"),
          c = machine("c");
        withMesh(f, (mesh) => {
          mesh.admit(f, a);
          mesh.admit(f, b);
          mesh.admit(a, c);
          const rest = Array.from({ length: 9 }, (_, i) => machine(`m${i + 1}`));
          for (const m of rest.slice(0, 8)) mesh.admit(f, m);
          mesh.revoke(f, a);
          const [m1, , , , , , , , m9] = rest;
          if (m1 === undefined || m9 === undefined) throw new Error("no m1 or m9");
          mesh.admit(f, m9);
          mesh.admit(m1, a);
          mesh.admit(b, a);
          const records = mesh.store.read()?.records ?? [];
          expect(viewOf(records).overCap.has(signPubOf(a))).toBe(true);
          expect(plan(mesh, f, "b", true).keys).toEqual([signPubOf(b)]);
        });
      },
      LARGE_MESH_MS,
    );

    test(
      "an over-cap key is found by the name on its card (L10)",
      () => {
        const f = machine("f"),
          a = machine("a"),
          z = machine("z");
        withMesh(f, (mesh) => {
          twelve(mesh, f, a);
          mesh.admit(a, z);
          expect(plan(mesh, f, "z").target).toEqual(ref(z));
        });
      },
      LARGE_MESH_MS,
    );
  });

  test("an exact hostId wins over a member renamed to that hostId", () => {
    const f = machine("f"),
      a = machine("a"),
      b = machine("b");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      mesh.admit(f, b);
      mesh.record(f, "name", { signPub: signPubOf(a), name: b.identity.hostId });
      expect(plan(mesh, f, b.identity.hostId).target.hostId).toBe(b.identity.hostId);
    });
  });

  test("it refuses this host and a key that is no member", () => {
    const f = machine("f"),
      a = machine("a");
    withMesh(f, (mesh) => {
      mesh.admit(f, a);
      expect(() => plan(mesh, f, "f")).toThrow("mesh leave");
      expect(() => plan(mesh, f, "nobody")).toThrow('no member "nobody"');
      mesh.revoke(f, a);
      expect(() => plan(mesh, f, a.identity.hostId)).toThrow("no member");
    });
  });
});
