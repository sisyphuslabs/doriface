import type { TerminalRunParams, Terminal } from "@doriface/protocol";
import { machineOf } from "./model.ts";

/**
 * New terminal starts where the active one is: on its machine, in its directory (the shell's current one when hc
 * reports it), with its space label, so it joins the active space. With no terminal in focus it starts where the selected
 * space is, on that space's machine, as herdr-app's `folder_for` falls back to the space's folder; with neither, the
 * core's default.
 */
export function runParamsFor(
  active: Terminal | undefined,
  selected?: { readonly dir: string; readonly machine?: string },
): TerminalRunParams {
  if (active === undefined) {
    if (selected === undefined) return {};
    return {
      ...(selected.dir === "" ? {} : { cwd: selected.dir }),
      ...(selected.machine === undefined ? {} : { on: selected.machine }),
    };
  }
  const machine = machineOf(active.address);
  const space = active.labels["space"];
  return {
    cwd: active.foreground?.cwd ?? active.cwd,
    ...(machine === undefined ? {} : { on: machine }),
    ...(space === undefined ? {} : { labels: { space } }),
  };
}
