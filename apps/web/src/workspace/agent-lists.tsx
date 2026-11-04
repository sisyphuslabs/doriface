import type { Terminal } from "@doriface/protocol";
import { AgentsGroup } from "./agents-group.tsx";
import { useMachinesContext } from "./use-machines.ts";
import { SpacesGroup } from "./spaces-group.tsx";

export interface AgentListsProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  /** The desktop sidebar dragged narrow: glyphs and avatars only. */
  readonly rail?: boolean;
  /** False on the phone, whose screen title already says "Agents". */
  readonly heading?: boolean;
}

/** The agents first, then the spaces (under their machines once there are more), on the desktop sidebar and the phone. */
export function AgentLists({ terminals, active, onOpen, rail = false, heading = true }: AgentListsProps) {
  const { ready } = useMachinesContext();
  if (!ready) return <div aria-busy="true" className="px-2 pb-3" />;
  return (
    <div className="flex flex-col gap-4 px-2 pb-3">
      <AgentsGroup terminals={terminals} active={active} onOpen={onOpen} rail={rail} heading={heading} />
      <SpacesGroup terminals={terminals} active={active} onOpen={onOpen} rail={rail} />
    </div>
  );
}
