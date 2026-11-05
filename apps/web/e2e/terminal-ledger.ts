// The run's terminal ledger: one JSON line per event the terminal guard (terminal-guard.ts) sees, appended by the
// workers and read by the run's teardown (terminal-leaks.ts).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_WEB_PORT } from "./config.ts";

/** One run's ledger directory, shared by its workers and its teardown. */
export const LEDGER_DIR = join(tmpdir(), `doriface-web-e2e-${E2E_WEB_PORT}-terminals`);
const LEDGER = join(LEDGER_DIR, "ledger.jsonl");

/**
 * `leak`: terminals still on the core once their owner was done, and why ending them failed, if it did; the worker that
 * found it (`where`) failed with it. `ended`: terminals a test opened and the guard ended for it. `before`: the core as
 * a test found it. `end`: the core as a worker left it. `cores`: hc processes its host left running once stopped.
 */
export type Entry =
  | {
      readonly kind: "leak";
      readonly where: string;
      readonly owner: string;
      readonly spec: string;
      readonly live: readonly string[];
      readonly finished: readonly string[];
      readonly errors: readonly string[];
    }
  | { readonly kind: "ended"; readonly owner: string; readonly spec: string; readonly count: number }
  | { readonly kind: "before"; readonly owner: string; readonly live: number; readonly finished: number }
  | { readonly kind: "end"; readonly where: string; readonly live: number; readonly finished: number }
  | { readonly kind: "cores"; readonly where: string; readonly left: readonly string[] };

export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export function record(entry: Entry): void {
  mkdirSync(LEDGER_DIR, { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`);
}

function parse(line: string): Entry {
  const entry: unknown = JSON.parse(line);
  if (typeof entry !== "object" || entry === null) throw new Error(`${LEDGER}: ${line} is no entry`);
  const field = (name: string): unknown => Reflect.get(entry, name);
  const kind = field("kind");
  const [owner, spec, where] = [String(field("owner")), String(field("spec")), String(field("where"))];
  if (kind === "leak") {
    const [live, finished, errors] = [strings(field("live")), strings(field("finished")), strings(field("errors"))];
    return { kind, where, owner, spec, live, finished, errors };
  }
  if (kind === "ended") return { kind, owner, spec, count: Number(field("count")) };
  if (kind === "cores") return { kind, where, left: strings(field("left")) };
  const [live, finished] = [Number(field("live")), Number(field("finished"))];
  if (kind === "before") return { kind, owner, live, finished };
  if (kind === "end") return { kind, where, live, finished };
  throw new Error(`${LEDGER}: ${line} has an unknown kind`);
}

export function readLedger(): Entry[] {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map(parse);
}

export function resetLedger(): void {
  rmSync(LEDGER_DIR, { recursive: true, force: true });
  mkdirSync(LEDGER_DIR, { recursive: true });
}
