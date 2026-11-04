// Every spec leaves the e2e core with the terminals it found there (#226). A test's terminals are the ones listed
// after it that were not listed before it.
// A spec file's beforeAll terminals are the ones that appeared between the last test of the file before it (or a new
// worker's start) and its own first test; its afterAll hooks end them. Whatever is still on the core once its owner is
// done is a leak, failed by the worker that found it: a test's own leak fails that test, and a leak found between tests
// (a late terminal, a beforeAll terminal its afterAll left) fails the worker as it ends, naming the spec either way.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { TestInfo } from "@playwright/test";
import { E2E_HOST_ENV, E2E_HOST_PORT, E2E_SLOT } from "./config.ts";
import { hcOn } from "./machine-switch.ts";
import { readSavedEnv } from "./saved-env.ts";
import { LEDGER_DIR, record, strings } from "./terminal-ledger.ts";

interface Terminal {
  /** As hc lists it now: `t7`, or `<machine name>/t7` for the added machine, whose name a spec may change. */
  readonly address: string;
  readonly live: boolean;
}

/** The e2e core's terminals, live and finished, by a key that survives a machine rename: `<machine id>/t7`. */
type Listing = ReadonlyMap<string, Terminal>;

/** What a worker remembers between tests, in a file so a restarted worker on the same core carries on. */
interface CoreState {
  readonly worker: number;
  readonly spec: string;
  readonly owner: string;
  readonly listed: readonly string[];
  /** Terminals the current spec file's beforeAll hooks started; its afterAll hooks end them. */
  readonly fileOwned: readonly string[];
}

/** Each `hc <command> --json` list entry as an object. */
function entries(command: string, field: string): object[] {
  const listed: unknown = JSON.parse(hcOn("host", [command, ...(command === "ls" ? ["--all"] : ["ls"]), "--json"]));
  const items = typeof listed === "object" && listed !== null ? Reflect.get(listed, field) : undefined;
  if (!Array.isArray(items)) throw new Error(`hc ${command} printed no ${field} list`);
  return items.map((item: unknown) => {
    if (typeof item !== "object" || item === null) throw new Error(`hc ${command} listed ${String(item)}`);
    return item;
  });
}

function list(): Listing {
  const ids = new Map(
    entries("machine", "machines").map((m) => [String(Reflect.get(m, "name")), Reflect.get(m, "id")]),
  );
  return new Map(
    entries("ls", "terminals").map((terminal) => {
      const address = Reflect.get(terminal, "address");
      if (typeof address !== "string") throw new Error("hc ls listed a terminal with no address");
      const slash = address.lastIndexOf("/");
      const machine = slash < 0 ? "" : address.slice(0, slash);
      const key = slash < 0 ? address : `${String(ids.get(machine) ?? machine)}/${address.slice(slash + 1)}`;
      return [key, { address, live: Reflect.get(terminal, "state") === "live" }];
    }),
  );
}

/** Which worker slot and e2e host found a leak, for its message and the ledger. */
export const WHERE = `worker ${E2E_SLOT}, e2e host :${E2E_HOST_PORT}`;
/** Leaks this worker found between tests: it fails with them as it ends. */
const pending: string[] = [];

/** The addresses of `keys` still on the core, live and finished. */
function left(now: Listing, keys: readonly string[]): { readonly live: string[]; readonly finished: string[] } {
  const found = keys.flatMap((key) => now.get(key) ?? []);
  return {
    live: found.filter((terminal) => terminal.live).map((terminal) => terminal.address),
    finished: found.filter((terminal) => !terminal.live).map((terminal) => terminal.address),
  };
}

interface Found {
  readonly now: Listing;
  /** The leak, as the failure names it; undefined when `keys` left nothing on the core. */
  readonly leak: string | undefined;
}

/** Records `keys` still on the core as a leak of `owner`. */
function leak(now: Listing, owner: string, spec: string, keys: readonly string[]): Found {
  const { live, finished } = left(now, keys);
  if (live.length + finished.length === 0) return { now, leak: undefined };
  record({ kind: "leak", where: WHERE, owner, spec, live, finished, errors: [] });
  return { now, leak: `${owner}: ${live.length} live [${live.join(" ")}], ${finished.length} finished [${finished.join(" ")}]` };
}

const fail = (leaks: readonly string[]): Error =>
  new Error(`terminal guard (${WHERE}): left on the e2e core:\n  ${leaks.join("\n  ")}`);

/** The state file of the core the specs run against: a new core starts a new file. */
function stateFile(): string {
  const session = readSavedEnv(E2E_HOST_ENV).env["HC_SESSION"] ?? "unknown";
  return join(LEDGER_DIR, `core-${session}.json`);
}

function readState(): CoreState | undefined {
  const file = stateFile();
  if (!existsSync(file)) return undefined;
  const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof saved !== "object" || saved === null) throw new Error(`${file} holds no core state`);
  return {
    worker: Number(Reflect.get(saved, "worker")),
    spec: String(Reflect.get(saved, "spec")),
    owner: String(Reflect.get(saved, "owner")),
    listed: strings(Reflect.get(saved, "listed")),
    fileOwned: strings(Reflect.get(saved, "fileOwned")),
  };
}

function writeState(state: CoreState): void {
  mkdirSync(LEDGER_DIR, { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state));
}

const specOf = (info: TestInfo): string => relative(info.project.testDir, info.file);
const ownerOf = (info: TestInfo): string => `${specOf(info)}:${info.line} ${info.titlePath.slice(1).join(" > ")}`;
const newIn = (now: Listing, known: readonly string[]): string[] =>
  [...now.keys()].filter((key) => !known.includes(key));
const count = (now: Listing): { readonly live: number; readonly finished: number } => {
  const live = [...now.values()].filter((terminal) => terminal.live).length;
  return { live, finished: now.size - live };
};

/** Before a test: checks what appeared since the last test, and returns the core as the test finds it. */
export function beginTest(info: TestInfo): Listing {
  let now = list();
  const state = readState();
  const spec = specOf(info);
  let fileOwned = state?.fileOwned ?? [];
  if (state !== undefined && state.spec === spec && state.worker === info.workerIndex) {
    // Nothing runs between two tests of one file in one worker: a terminal that appeared came from the test before.
    const late = leak(now, state.owner, state.spec, newIn(now, state.listed));
    now = late.now;
    if (late.leak !== undefined) pending.push(late.leak);
  } else if (state !== undefined) {
    const kept = leak(now, `${state.spec} beforeAll`, state.spec, state.fileOwned);
    now = kept.now;
    if (kept.leak !== undefined) pending.push(kept.leak);
    fileOwned = newIn(now, state.listed);
  }
  record({ kind: "before", owner: ownerOf(info), ...count(now) });
  writeState({ worker: info.workerIndex, spec, owner: ownerOf(info), listed: [...now.keys()], fileOwned });
  return now;
}

/** After a test, its pages closed: fails the test if it left terminals on the core. */
export function endTest(info: TestInfo, before: Listing): void {
  const [owner, spec] = [ownerOf(info), specOf(info)];
  const now = list();
  const own = leak(now, owner, spec, newIn(now, [...before.keys()]));
  const fileOwned = readState()?.fileOwned ?? [];
  writeState({ worker: info.workerIndex, spec, owner, listed: [...own.now.keys()], fileOwned });
  if (own.leak !== undefined) throw fail([own.leak]);
}

/** As a worker ends, after its last file's afterAll hooks: checks the last test and file, and fails with every leak. */
export function endWorker(): void {
  const state = readState();
  if (state === undefined) return;
  const now = list();
  const late = leak(now, state.owner, state.spec, newIn(now, state.listed));
  const kept = leak(late.now, `${state.spec} beforeAll`, state.spec, state.fileOwned);
  for (const found of [late.leak, kept.leak]) if (found !== undefined) pending.push(found);
  record({ kind: "end", where: WHERE, ...count(kept.now) });
  writeState({ ...state, worker: -1, listed: [...kept.now.keys()], fileOwned: [] });
  if (pending.length > 0) throw fail(pending.splice(0));
}
