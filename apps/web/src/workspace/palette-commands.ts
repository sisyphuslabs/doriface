import type { Terminal } from "@doriface/protocol";
import type { Command } from "@doriface/ui";
import { ACTION_BY_ID } from "../keys/actions.ts";
import type { Keymap } from "../keys/defaults.ts";
import { triggersFor } from "../keys/keymap.ts";
import { triggerKeys, type Platform } from "../keys/trigger.ts";
import type { AgentStatus } from "@doriface/ui";
import { agentStatus, machineOf, terminalTitle } from "./model.ts";

const AGENT = "agent:";
/** The palette leads with the agent that needs you, as the sidebar sections do. */
const URGENCY: Readonly<Record<AgentStatus, number>> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
const HOST = "host:";

export interface PaletteSource {
  readonly terminals: readonly Terminal[];
  readonly host: string;
  readonly route: string;
  readonly keymap: Keymap;
  readonly platform: Platform;
  /** The app actions this shell handles now, from availableActions. */
  readonly actions: readonly string[];
}

export type PaletteChoice =
  | { readonly kind: "agent"; readonly address: string }
  | { readonly kind: "action"; readonly id: string }
  | { readonly kind: "settings" };

function command(source: PaletteSource, id: string, group: string): Command {
  const label = ACTION_BY_ID.get(id)?.label ?? id;
  const [trigger] = triggersFor(source.keymap, id);
  return trigger === undefined
    ? { id, label, group }
    : { id, label, group, keys: triggerKeys(trigger, source.platform) };
}

/** Agents (live terminals with their state), then Actions, Hosts and General, as DESIGN.md brief (c) lists them. */
export function paletteCommands(source: PaletteSource): Command[] {
  const agents = source.terminals
    .filter((terminal) => terminal.state === "live")
    .toSorted((a, b) => URGENCY[agentStatus(a)] - URGENCY[agentStatus(b)])
    .map((terminal): Command => {
      const machine = machineOf(terminal.address);
      const id = `${AGENT}${terminal.address}`;
      const row: Command = { id, label: terminalTitle(terminal), group: "Agents", status: agentStatus(terminal) };
      return machine === undefined ? row : Object.assign(row, { hint: machine });
    });
  return [
    ...agents,
    ...source.actions.filter((id) => id !== "app.settings").map((id) => command(source, id, "Actions")),
    { id: `${HOST}${source.host}`, label: source.host, group: "Hosts", hint: source.route },
    ...(source.actions.includes("app.settings") ? [command(source, "app.settings", "General")] : []),
  ];
}

/** What running a palette row does. */
export function choiceOf(id: string): PaletteChoice {
  if (id.startsWith(AGENT)) return { kind: "agent", address: id.slice(AGENT.length) };
  if (id.startsWith(HOST)) return { kind: "settings" };
  return { kind: "action", id };
}
