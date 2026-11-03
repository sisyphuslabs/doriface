import type { TerminalRunParams, Terminal } from "@doriface/protocol";
import { machineOf } from "./model.ts";

/**
 * New terminal starts where the active one is: on its machine, in its directory (the shell's current one when hc
 * reports it), with its space label, so it joins the active space. With nothing active it is the core's default.
 */
export function runParamsFor(active: Terminal | undefined): TerminalRunParams {
  if (active === undefined) return {};
  const machine = machineOf(active.address);
  const space = active.labels["space"];
  return {
    cwd: active.foreground?.cwd ?? active.cwd,
    ...(machine === undefined ? {} : { on: machine }),
    ...(space === undefined ? {} : { labels: { space } }),
  };
}

/**
 * The active terminal as hc sees it now: the snapshot keeps the directory its shell started in, while terminal.get
 * reports where the shell is after a cd. Only the directory is taken from it: the address and labels stay the
 * snapshot's, which name the machine as this client addresses it. If the read fails, the snapshot is still the best
 * place to start.
 */
export function currentTerminal(
  get: (address: string) => Promise<Terminal>,
  active: Terminal | undefined,
): Promise<Terminal | undefined> {
  if (active === undefined) return Promise.resolve(undefined);
  return get(active.address).then(
    (current) =>
      Object.assign({ ...active, cwd: current.cwd }, current.foreground ? { foreground: current.foreground } : {}),
    () => active,
  );
}
