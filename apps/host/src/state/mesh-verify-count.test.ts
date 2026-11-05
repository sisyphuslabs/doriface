import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machine, MeshFixture } from "../testing/mesh-history.ts";

// The mesh package's own ed25519, the one its signature checks call: this package does not depend on it.
const meshSrc = join(import.meta.dir, "../../../../packages/mesh/src");
const { ed25519 } = (await import(Bun.resolveSync("@noble/curves/ed25519.js", meshSrc))) as {
  readonly ed25519: { verify(...args: unknown[]): boolean };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Signature checks (records and cards alike) one admit costs, through the store, after `stored` earlier admits. */
function verifiesForAdmitAfter(stored: number): number {
  const dir = mkdtempSync(join(tmpdir(), "mesh-verify-"));
  dirs.push(dir);
  const founder = machine("founder");
  const fixture = new MeshFixture(dir, founder);
  for (let index = 0; index < stored; index += 1) fixture.admit(founder, machine(`member-${index}`));
  const verify = spyOn(ed25519, "verify");
  try {
    fixture.admit(founder, machine("newcomer"));
    return verify.mock.calls.length;
  } finally {
    verify.mockRestore();
  }
}

test("a mesh.json write checks the signatures of its new records only, however many cards are stored (#94)", () => {
  const few = verifiesForAdmitAfter(2);
  const many = verifiesForAdmitAfter(11);
  console.log(`signature checks for one admit: after 2 admits ${few}, after 11 admits ${many}`);
  expect(many).toBe(few);
});
