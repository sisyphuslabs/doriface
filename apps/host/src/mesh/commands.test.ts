import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, type Signed, viewOf } from "@doriface/mesh";
import { MeshStore } from "../state/mesh.ts";
import { type Machine, machine, MeshFixture, signPubOf } from "../testing/mesh-history.ts";
import { MeshCommands } from "./commands.ts";
import { IDLE_MESH_HOOKS, type MeshHooks } from "./host-hooks.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Bench {
  readonly mesh: MeshFixture;
  readonly commands: MeshCommands;
  readonly pushed: (readonly Signed[])[];
  readonly closes: { count: number };
  readonly dir: string;
  /** The fixture merges the host's own records without its counter; catch it up, as a sync with no later one would. */
  readonly ready: () => void;
}

function bench(host: Machine, confirm: (records: readonly Signed[]) => readonly string[] = () => []): Bench {
  const dir = mkdtempSync(join(tmpdir(), "dh-mesh-cmd-"));
  dirs.push(dir);
  const mesh = new MeshFixture(dir, host);
  const pushed: (readonly Signed[])[] = [];
  const closes = { count: 0 };
  const hooks: MeshHooks = {
    ...IDLE_MESH_HOOKS,
    push: (records) => {
      pushed.push(records);
      expect(existsSync(join(dir, "mesh.json"))).toBe(true);
      return Promise.resolve(confirm(records));
    },
  };
  const commands = new MeshCommands({
    store: mesh.store,
    stateDir: dir,
    identity: host.identity,
    closeRevoked: () => void closes.count++,
    hooks,
    log: () => {},
  });
  return { mesh, commands, pushed, closes, dir, ready: () => mesh.store.catchUp(host.identity) };
}

const records = (b: Bench): readonly Signed[] => b.mesh.store.read()?.records ?? [];
const last = (b: Bench) => parseRecord(records(b).at(-1) ?? { body: "", sig: "" });

describe("mesh-revoke on the running host (design 6.1, 6.2)", () => {
  test("writes one revoke, closes the revoked sessions and pushes the record", async () => {
    const f = machine("f"),
      a = machine("a"),
      b = machine("b");
    const it = bench(f);
    it.mesh.admit(f, a);
    it.mesh.admit(f, b);
    it.mesh.record(a, "ack");
    it.ready();
    const reply = await it.commands.revoke({ member: "a", compromised: false, yes: false });
    expect(reply).toMatchObject({ written: true, reason: "revoke", subjects: [{ name: "a" }] });
    expect(last(it)?.subject).toEqual({ signPubs: [signPubOf(a)], reason: "revoke" });
    expect(viewOf(records(it)).members.has(signPubOf(a))).toBe(false);
    expect(it.closes.count).toBe(1);
    expect(it.pushed).toEqual([records(it).slice(-1)]);
  });

  test("--compromised without --yes writes nothing and returns the preview; with --yes one record names all", async () => {
    const f = machine("f"),
      a = machine("a"),
      b = machine("b"),
      d = machine("d");
    const it = bench(f);
    it.mesh.admit(f, a);
    it.mesh.admit(f, b);
    it.mesh.admit(a, d);
    it.ready();
    const before = records(it).length;
    const preview = await it.commands.revoke({ member: "a", compromised: true, yes: false });
    expect(preview).toMatchObject({ written: false, needsYes: true, subjects: [{ name: "a" }, { name: "d" }] });
    expect(records(it)).toHaveLength(before);
    expect(it.pushed).toEqual([]);
    await it.commands.revoke({ member: "a", compromised: true, yes: true });
    expect(records(it)).toHaveLength(before + 1);
    expect(last(it)?.subject).toEqual({ signPubs: [signPubOf(a), signPubOf(d)], reason: "compromised" });
  });

  test("--compromised on a member that admitted an over-cap key revokes that key too, so it never becomes a member", async () => {
    const f = machine("f"),
      a = machine("a"),
      z = machine("z");
    const it = bench(f);
    it.mesh.admit(f, a);
    for (let i = 1; i <= 10; i++) it.mesh.admit(f, machine(`m${i}`));
    it.mesh.admit(a, z);
    it.ready();
    const reply = await it.commands.revoke({ member: "a", compromised: true, yes: true });
    expect(reply?.subjects.map((subject) => subject.hostId)).toEqual([a.identity.hostId, z.identity.hostId]);
    const view = viewOf(records(it));
    expect(view.members.has(signPubOf(z))).toBe(false);
    expect(view.overCap.has(signPubOf(z))).toBe(false);
    expect(view.revoked.has(signPubOf(z))).toBe(true);
  });

  test("a preview writes nothing, even with yes, and a write whose previewed subjects changed is refused", async () => {
    const f = machine("f"),
      a = machine("a"),
      d = machine("d");
    const it = bench(f);
    it.mesh.admit(f, a);
    it.mesh.admit(a, d);
    it.ready();
    const before = records(it).length;
    const preview = await it.commands.revoke({ member: "a", compromised: true, yes: true, preview: true });
    expect(preview).toMatchObject({ written: false, subjects: [{ name: "a" }, { name: "d" }] });
    expect(records(it)).toHaveLength(before);
    const stale = { member: "a", compromised: true, yes: true, expect: [a.identity.hostId] };
    await expect(it.commands.revoke(stale)).rejects.toThrow("changed since the preview");
    expect(records(it)).toHaveLength(before);
    const expected = [a, d].map((m) => m.identity.hostId);
    expect(await it.commands.revoke({ ...stale, expect: expected })).toMatchObject({ written: true });
  });

  test("an undecidable revoke waits for --yes", async () => {
    const f = machine("f"),
      a = machine("a");
    const it = bench(f);
    it.mesh.admit(f, a);
    it.ready();
    expect(await it.commands.revoke({ member: "a", compromised: false, yes: false })).toMatchObject({
      written: false,
      needsYes: true,
    });
    expect(await it.commands.revoke({ member: "a", compromised: false, yes: true })).toMatchObject({ written: true });
  });

  test("a host in no mesh answers null, and a revoked host signs nothing", async () => {
    const f = machine("f"),
      a = machine("a");
    const dir = mkdtempSync(join(tmpdir(), "dh-mesh-cmd-"));
    dirs.push(dir);
    const it = bench(f);
    const none = new MeshCommands({ ...it.commands.deps, stateDir: dir, store: new MeshStore(dir, { log: () => {} }) });
    expect(await none.revoke({ member: "a", compromised: false, yes: true })).toBeNull();
    expect(await none.rename({ member: "a", name: "b" })).toBeNull();
    expect(await none.leave()).toBeNull();
    it.mesh.admit(f, a);
    const asA = new MeshCommands({ ...it.commands.deps, identity: a.identity });
    it.mesh.revoke(f, a);
    await expect(asA.rename({ member: "f", name: "g" })).rejects.toThrow("signs nothing");
  });
});

describe("mesh-rename (design 7.4, 7.5)", () => {
  test("writes a name record that the view applies, and pushes it", async () => {
    const f = machine("f"),
      a = machine("a");
    const it = bench(f);
    it.mesh.admit(f, a);
    it.ready();
    expect(await it.commands.rename({ member: "a", name: "a2" })).toEqual({
      written: true,
      member: { hostId: a.identity.hostId, name: "a" },
      name: "a2",
    });
    expect(last(it)?.subject).toEqual({ signPub: signPubOf(a), name: "a2" });
    expect(viewOf(records(it)).name.get(signPubOf(a))).toBe("a2");
    expect(it.pushed).toHaveLength(1);
  });

  test("refuses herdr-invalid names and another member's name, and writes nothing for the same name", async () => {
    const f = machine("f"),
      a = machine("a");
    const it = bench(f);
    it.mesh.admit(f, a);
    const before = records(it).length;
    await Promise.all(
      ["A", "t7", "x".repeat(33), "-a"].map((bad) =>
        expect(it.commands.rename({ member: "a", name: bad })).rejects.toThrow("not a valid mesh name"),
      ),
    );
    await expect(it.commands.rename({ member: "a", name: "f" })).rejects.toThrow(`"f" is ${f.identity.hostId}`);
    await expect(it.commands.rename({ member: "a", name: f.identity.hostId })).rejects.toThrow(
      `"${f.identity.hostId}" is the hostId of`,
    );
    expect(await it.commands.rename({ member: "a", name: "a" })).toMatchObject({ written: false });
    expect(records(it)).toHaveLength(before);
  });
});

describe("mesh-leave (design 6.5)", () => {
  test("a push that rejects counts as no confirmation, and leaving still completes", async () => {
    const a = machine("a"),
      f = machine("f");
    const it = bench(a);
    it.mesh.admit(a, f);
    it.ready();
    const logs: string[] = [];
    const hooks: MeshHooks = {
      ...IDLE_MESH_HOOKS,
      push: () => Promise.reject(new Error("no session")),
      left: () => Promise.reject(new Error("no core")),
    };
    const leaving = new MeshCommands({ ...it.commands.deps, hooks, log: (line) => void logs.push(line) });
    expect(await leaving.leave()).toMatchObject({
      signed: true,
      confirmed: [],
      revokeCommand: "doriface-host mesh revoke a",
    });
    expect(existsSync(join(it.dir, "mesh.json"))).toBe(false);
    expect(logs.filter((line) => line.startsWith("mesh:"))).toHaveLength(2);
  });

  test("signs a self-revoke, pushes it before deleting mesh.json, and reports who confirmed", async () => {
    const a = machine("a"),
      f = machine("f"),
      b = machine("b");
    const it = bench(a, () => [signPubOf(f)]);
    it.mesh.admit(a, f);
    it.mesh.admit(a, b);
    it.ready();
    const reply = await it.commands.leave();
    const self = parseRecord(it.pushed[0]?.[0] ?? { body: "", sig: "" });
    expect(self).toMatchObject({
      type: "revoke",
      by: signPubOf(a),
      subject: { signPubs: [signPubOf(a)], reason: "leave" },
    });
    expect(existsSync(join(it.dir, "mesh.json"))).toBe(false);
    expect(reply).toEqual({
      signed: true,
      members: [f, b].map((m) => ({ hostId: m.identity.hostId, name: m.name })),
      confirmed: [{ hostId: f.identity.hostId, name: "f" }],
      revokeCommand: null,
    });
    expect(it.closes.count).toBe(1);
  });

  test("reaching nobody, it still leaves and prints the revoke to run elsewhere", async () => {
    const f = machine("f"),
      a = machine("a");
    const it = bench(f);
    it.mesh.admit(f, a);
    const asA = new MeshCommands({ ...it.commands.deps, identity: a.identity });
    expect(await asA.leave()).toMatchObject({
      signed: true,
      confirmed: [],
      revokeCommand: "doriface-host mesh revoke a",
    });
    expect(existsSync(join(it.dir, "mesh.json"))).toBe(false);
  });
});
