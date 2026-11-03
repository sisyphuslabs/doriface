import { parseRecord, type RecordBody, type Signed } from "@doriface/mesh";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshCommands } from "../mesh/commands.ts";
import { IDLE_MESH_HOOKS, type MeshHooks } from "../mesh/host-hooks.ts";
import { type Machine, MeshFixture } from "./mesh-history.ts";

/** `MeshCommands` for `host` on a fresh mesh it founded, with hooks that record every push. */
export interface CommandBench {
  readonly mesh: MeshFixture;
  readonly commands: MeshCommands;
  readonly pushed: (readonly Signed[])[];
  /** Per push, whether mesh.json still existed when it ran. */
  readonly storedAtPush: boolean[];
  readonly closes: { count: number };
  readonly dir: string;
  /** The fixture merges the host's own records without its counter; catch it up, as a sync with no later one would. */
  readonly ready: () => void;
}

/**
 * Budget for tests that build a mesh of 12 or more keys through the store. The view is about 8 ms per write; most of
 * the 50-90 ms per write is ed25519 re-verification of every stored card by the authorize index, the door and
 * `recordsOf` (#94), so these tests run in about 0.5 s alone and several seconds on a loaded machine.
 */
export const LARGE_MESH_MS = 30_000;

const dirs: string[] = [];

export function removeBenches(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function commandBench(
  host: Machine,
  confirm: (records: readonly Signed[]) => readonly string[] = () => [],
): CommandBench {
  const dir = mkdtempSync(join(tmpdir(), "dh-mesh-cmd-"));
  dirs.push(dir);
  const mesh = new MeshFixture(dir, host);
  const pushed: (readonly Signed[])[] = [];
  const storedAtPush: boolean[] = [];
  const closes = { count: 0 };
  const hooks: MeshHooks = {
    ...IDLE_MESH_HOOKS,
    push: (records) => {
      pushed.push(records);
      storedAtPush.push(existsSync(join(dir, "mesh.json")));
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
  return { mesh, commands, pushed, storedAtPush, closes, dir, ready: () => mesh.store.catchUp(host.identity) };
}

export const benchRecords = (bench: CommandBench): readonly Signed[] => bench.mesh.store.read()?.records ?? [];

export const lastRecord = (bench: CommandBench): RecordBody | undefined =>
  parseRecord(benchRecords(bench).at(-1) ?? { body: "", sig: "" });
