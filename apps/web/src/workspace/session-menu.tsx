import { IconButton, Menu, MenuItem } from "@doriface/ui";
import { Ellipsis, Pencil, Power } from "lucide-react";
import { useAskSession } from "./session-context.ts";

export interface SessionMenuProps {
  readonly address: string;
  readonly title: string;
  /** `strip`: the desktop tab strip's compact glyph; `header`: the phone terminal header's full control target. */
  readonly placement?: "strip" | "header";
}

/** The actions on a terminal's session: rename it, or end its program. */
export function SessionMenu({ address, title, placement = "strip" }: SessionMenuProps) {
  const ask = useAskSession();
  const label = `Session actions for ${title}`;
  return (
    <Menu
      align="end"
      trigger={
        placement === "header" ? (
          <IconButton label={label} icon={<Ellipsis />} size="md" />
        ) : (
          <IconButton label={label} icon={<Ellipsis />} className="size-6" />
        )
      }
    >
      <MenuItem icon={<Pencil />} onClick={() => ask({ kind: "rename", address })}>
        Rename…
      </MenuItem>
      <MenuItem icon={<Power />} destructive onClick={() => ask({ kind: "end", address })}>
        End session…
      </MenuItem>
    </Menu>
  );
}
