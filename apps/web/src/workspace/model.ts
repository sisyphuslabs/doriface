import type { Terminal } from "@doriface/protocol";
import type { Agent, AgentStatus, Space } from "@doriface/ui";

const OSC_STATES: Readonly<Record<string, AgentStatus>> = {
  working: "working",
  blocked: "blocked",
  error: "blocked",
  done: "done",
  idle: "idle",
};

/**
 * The one status selector every surface uses (sidebar section, pane chip, tab glyph, space attention).
 * A program that never reported OSC 7501, or reported a word outside the protocol's, reads as idle.
 */
export function agentStatus(terminal: Terminal): AgentStatus {
  if (terminal.state === "finished") return "done";
  const word = terminal.status?.state;
  return word !== undefined && Object.hasOwn(OSC_STATES, word) ? (OSC_STATES[word] ?? "idle") : "idle";
}

export function terminalTitle(terminal: Terminal): string {
  const named = terminal.name ?? terminal.title;
  if (named !== undefined && named !== null && named !== "") return named;
  return terminal.foreground?.name ?? terminal.argv[0] ?? terminal.address;
}

export function machineOf(address: string): string | undefined {
  const slash = address.indexOf("/");
  return slash === -1 ? undefined : address.slice(0, slash);
}

function basename(path: string): string {
  return path.split("/").findLast((part) => part !== "") ?? "/";
}

/** A space is the `space` label, else the working directory's last segment. */
export function spaceName(terminal: Terminal): string {
  return terminal.labels["space"] ?? basename(terminal.foreground?.cwd ?? terminal.cwd);
}

/** "<1m", "6m", "2h", "3d" since a moment, for agent rows. */
export function formatAge(sinceMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - sinceMs) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Every live terminal as a row: its reported state, what it said, where it runs and since when. */
export function toAgent(terminal: Terminal, nowMs: number): Agent {
  const machine = machineOf(terminal.address);
  const said = terminal.status?.msg ?? terminal.status?.title;
  const detail = said === undefined || said === "" ? spaceName(terminal) : said;
  const agent: Agent = {
    id: terminal.address,
    name: terminalTitle(terminal),
    status: agentStatus(terminal),
    detail,
    age: formatAge(terminal.status_ms ?? terminal.created_ms, nowMs),
  };
  return machine === undefined ? agent : Object.assign(agent, { machine });
}

export interface AgentGroups {
  readonly blocked: readonly Agent[];
  readonly done: readonly Agent[];
  readonly working: readonly Agent[];
  readonly idle: readonly Agent[];
}

/** Needs you, Done, Working, Idle; programs that never reported sit with Idle. */
export function groupAgents(terminals: readonly Terminal[], nowMs: number): AgentGroups {
  const groups = { blocked: [] as Agent[], done: [] as Agent[], working: [] as Agent[], idle: [] as Agent[] };
  for (const terminal of terminals) {
    if (terminal.state !== "live") continue;
    const agent = toAgent(terminal, nowMs);
    if (agent.status !== "unknown") groups[agent.status].push(agent);
  }
  return groups;
}

const ATTENTION: readonly AgentStatus[] = ["blocked", "working", "done"];

export function toSpaces(terminals: readonly Terminal[]): Space[] {
  const groups = new Map<string, { name: string; machine: string | undefined; statuses: Set<AgentStatus> }>();
  for (const terminal of terminals) {
    if (terminal.state !== "live") continue;
    const machine = machineOf(terminal.address);
    const name = spaceName(terminal);
    const key = `${machine ?? ""}/${name}`;
    const group = groups.get(key) ?? { name, machine, statuses: new Set<AgentStatus>() };
    group.statuses.add(agentStatus(terminal));
    groups.set(key, group);
  }
  return [...groups].map(([id, group]) => {
    const attention = ATTENTION.find((status) => group.statuses.has(status));
    const tabs = terminals.filter(
      (t) => t.state === "live" && `${machineOf(t.address) ?? ""}/${spaceName(t)}` === id,
    ).length;
    const space: Space = { id, name: group.name, tabs };
    if (group.machine !== undefined) Object.assign(space, { machine: group.machine });
    if (attention !== undefined) Object.assign(space, { attention });
    return space;
  });
}

/** The first live terminal of a space, to open when the space is picked. */
export function firstInSpace(terminals: readonly Terminal[], spaceId: string): string | undefined {
  return terminals.find((t) => t.state === "live" && `${machineOf(t.address) ?? ""}/${spaceName(t)}` === spaceId)
    ?.address;
}
