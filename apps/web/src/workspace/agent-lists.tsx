import type { Terminal } from "@doriface/protocol";
import { AgentsGroup } from "./agents-group.tsx";
import { SpacesGroup } from "./spaces-group.tsx";

export interface AgentListsProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  /** The desktop sidebar dragged narrow: glyphs and avatars only. */
  readonly rail?: boolean;
}

/** The agents first, then the spaces (under their machines once there are more), on the desktop sidebar and the phone. */
export function AgentLists({ terminals, active, onOpen, rail = false }: AgentListsProps) {
  return (
    <div className="flex flex-col gap-4 px-2 pb-3">
      <AgentsGroup terminals={terminals} active={active} onOpen={onOpen} rail={rail} />
      <SpacesGroup terminals={terminals} active={active} onOpen={onOpen} rail={rail} />
    </div>
  );
}
