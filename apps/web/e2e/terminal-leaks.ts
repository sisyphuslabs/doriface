// Global setup: starts the run with an empty terminal ledger, and returns a teardown that reports it. The guard itself
// runs inside each worker (terminal-guard.ts), against that worker's own e2e core, and fails there; this only adds the
// run-wide picture, per spec and per worker.
import { type Entry, readLedger, resetLedger } from "./terminal-ledger.ts";

type Leak = Extract<Entry, { kind: "leak" }>;

/** One line per spec: how many terminals it left, live and finished, and which test or hook left them, where. */
function bySpec(leaks: readonly Leak[]): string[] {
  const specs = new Map<string, Leak[]>();
  for (const entry of leaks) specs.set(entry.spec, [...(specs.get(entry.spec) ?? []), entry]);
  return [...specs].map(([spec, entries]) => {
    const live = entries.reduce((sum, entry) => sum + entry.live.length, 0);
    const finished = entries.reduce((sum, entry) => sum + entry.finished.length, 0);
    const owners = entries.map((entry) => {
      const refused = entry.errors.length === 0 ? "" : `, could not end: ${entry.errors.join("; ")}`;
      return `${entry.owner} (${entry.where}) [${[...entry.live, ...entry.finished].join(" ")}${refused}]`;
    });
    return `  ${spec}: ${live} live, ${finished} finished, from ${owners.join("; ")}`;
  });
}

export default function terminalLeaks(): () => void {
  resetLedger();
  return () => {
    const ledger = readLedger();
    const checked = ledger.flatMap((entry) => (entry.kind === "before" ? [entry] : []));
    const most = checked.reduce<(typeof checked)[number] | undefined>(
      (top, entry) => (top === undefined || entry.live + entry.finished > top.live + top.finished ? entry : top),
      undefined,
    );
    const ended = ledger.flatMap((entry) => (entry.kind === "ended" ? [entry] : []));
    const ends = ledger.flatMap((entry) => (entry.kind === "end" ? [entry] : []));
    const leftLive = ends.reduce((sum, entry) => sum + entry.live, 0);
    const leftFinished = ends.reduce((sum, entry) => sum + entry.finished, 0);
    const cores = ledger.flatMap((entry) => (entry.kind === "cores" ? [entry] : []));
    console.log(
      `terminal guard: ${checked.length} tests checked; ${ended.reduce((sum, entry) => sum + entry.count, 0)} ` +
        `terminals ended for ${ended.length} tests in ${new Set(ended.map((entry) => entry.spec)).size} specs; ` +
        `most on a core before a test: ${most?.live ?? 0} live, ${most?.finished ?? 0} finished` +
        `${most === undefined ? "" : ` (before ${most.owner})`}; ` +
        `left on their cores as ${ends.length} workers ended: ${leftLive} live, ${leftFinished} finished; ` +
        `hc processes left by ${cores.length} stopped worker hosts: ${cores.reduce((sum, entry) => sum + entry.left.length, 0)}`,
    );
    const leaks = ledger.flatMap((entry) => (entry.kind === "leak" ? [entry] : []));
    if (leaks.length > 0) console.log(`terminal guard: specs that left terminals:\n${bySpec(leaks).join("\n")}`);
  };
}
