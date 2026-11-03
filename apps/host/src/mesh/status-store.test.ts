import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ViewCache, viewOf } from "@doriface/mesh";
import { machine, MeshFixture, signPubOf } from "../testing/mesh-history.ts";
import { planRevoke } from "./revoke-plan.ts";
import { IDLE_MESH_HOOKS } from "./host-hooks.ts";
import { meshStatus } from "./status.ts";
import { meshSourcesOf } from "./status-store.ts";

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
