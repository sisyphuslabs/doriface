import { HcRpcError } from "@doriface/protocol";
import { fallbacks } from "@doriface/mesh";
import type { MemberEntry } from "./authorize-index.ts";
import type { HcMachines } from "./hc-machines.ts";
import type { MeshEntry } from "./reconciler.ts";

async function renameTo(
  machines: HcMachines,
  log: (line: string) => void,
  current: string,
  names: readonly string[],
): Promise<void> {
  const [name, ...rest] = names;
  if (name === undefined) return;
  try {
    await machines.rename(current, name);
    log(`mesh: renamed machine ${current} to ${name}`);
  } catch (error) {
    if (!(error instanceof HcRpcError) || error.kind !== "name_taken") throw error;
    await renameTo(machines, log, current, rest);
  }
}

/** Renames a mesh line to its member's view name, or the first fallback free on this core (section 8.1). */
export async function renameToMeshName(
  machines: HcMachines,
  log: (line: string) => void,
  entry: MeshEntry,
  member: MemberEntry | undefined,
): Promise<void> {
  if (member === undefined) return;
  const allowed = [member.name, ...fallbacks(member.name, member.hostId)];
  if (allowed.includes(entry.machine.name)) return;
  await renameTo(machines, log, entry.machine.name, allowed);
}
