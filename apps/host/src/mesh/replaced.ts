import type { MachineView, MeshReplacedKind, MeshReplacedMachine } from "@doriface/protocol";

/** A via whose program is `doriface-host` (bare, a path, or single-quoted) and whose first argument is `connect`. */
const CONNECT_VIA = /^(?:'([^']*)'|(\S+))\s+connect(?:\s|$)/;

function kindOf(machine: MachineView): MeshReplacedKind {
  if (machine.via !== true) return "ssh";
  const match = CONNECT_VIA.exec(machine.target);
  const program = match?.[1] ?? match?.[2] ?? "";
  return program.split("/").at(-1) === "doriface-host" ? "connect" : "command";
}

/**
 * The machine entry a mesh line replaces, as status shows it: its name and how it had been added. The target itself
 * stays out, since an ssh target or a via can carry a user, an address or a key path.
 */
export const replacedOf = (machine: MachineView): MeshReplacedMachine => ({
  name: machine.name,
  kind: kindOf(machine),
});
