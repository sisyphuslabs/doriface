import type { MachineView } from "@doriface/protocol";

/** hc's permanent machine ids by the names this core gives them now, both ways. */
export interface MachineIds {
  readonly byName: ReadonlyMap<string, string>;
  readonly byId: ReadonlyMap<string, string>;
}

export function machineIds(machines: readonly MachineView[]): MachineIds {
  return {
    byName: new Map(machines.map((machine) => [machine.name, machine.id])),
    byId: new Map(machines.map((machine) => [machine.id, machine.name])),
  };
}

const LOCAL = "local:";
const ID = "id:";
const NAME = "name:";

/**
 * What a tab remembers its terminal by, so it survives a machine rename: `t7` is `local:t7`, `rohan/t7` is
 * `id:<rohan's id>/t7`, or `name:rohan/t7` until machine.list has named the machine.
 */
export function tabKey(address: string, ids: MachineIds): string {
  const slash = address.indexOf("/");
  if (slash === -1) return LOCAL + address;
  const id = ids.byName.get(address.slice(0, slash));
  return id === undefined ? NAME + address : ID + id + address.slice(slash);
}

/** The address the tab's terminal has now; undefined while its machine is not in the list. */
export function tabAddress(key: string, ids: MachineIds): string | undefined {
  if (key.startsWith(LOCAL)) return key.slice(LOCAL.length);
  if (key.startsWith(NAME)) return key.slice(NAME.length);
  const rest = key.slice(ID.length);
  const slash = rest.indexOf("/");
  const name = ids.byId.get(rest.slice(0, slash));
  return name === undefined ? undefined : name + rest.slice(slash);
}

export const isLocalKey = (key: string): boolean => key.startsWith(LOCAL);
