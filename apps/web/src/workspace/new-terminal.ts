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
