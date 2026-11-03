import { IconButton, Menu, MenuItem } from "@doriface/ui";
import { Ellipsis, Pencil, Power } from "lucide-react";
import { useAskSession } from "./session-context.ts";

/** The pane header's actions on its session: rename it, or end its program. */
export function SessionMenu({ address }: { readonly address: string }) {
  const ask = useAskSession();
  return (
    <Menu align="end" trigger={<IconButton label="Session actions" icon={<Ellipsis />} className="size-6" />}>
      <MenuItem icon={<Pencil />} onClick={() => ask({ kind: "rename", address })}>
        Rename…
      </MenuItem>
      <MenuItem icon={<Power />} destructive onClick={() => ask({ kind: "end", address })}>
        End session…
      </MenuItem>
    </Menu>
  );
}
