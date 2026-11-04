import type { Terminal } from "@doriface/protocol";
import { Button, IconButton, ScrollArea } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { PanelLeft, Search, Settings } from "lucide-react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { AgentLists } from "./agent-lists.tsx";
import { RovingLists } from "./roving-lists.tsx";

export interface SidebarProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  readonly onHide: () => void;
  readonly onPalette: () => void;
}

export function Sidebar({ terminals, active, onOpen, onHide, onPalette }: SidebarProps) {
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  return (
    <aside
      aria-label="Workspace"
      className="motion-arrive flex w-(--sidebar-width) shrink-0 flex-col border-r border-sidebar-border bg-sidebar [--arrive-from:translateX(-0.5rem)]"
    >
      <div
        data-titlebar
        className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-[var(--titlebar-inset-start,0.875rem)]"
      >
        <span className="flex-1 text-sm font-semibold text-sidebar-foreground">doriface</span>
        <IconButton
          label="Command palette"
          {...(paletteKeys === undefined ? {} : { keys: paletteKeys })}
          icon={<Search />}
          onClick={onPalette}
        />
        <IconButton
          label="Hide sidebar"
          {...(sidebarKeys === undefined ? {} : { keys: sidebarKeys })}
          icon={<PanelLeft />}
          onClick={onHide}
        />
      </div>
      <ScrollArea slot="agents-list" className="flex-1">
        <RovingLists>
          <AgentLists terminals={terminals} active={active} onOpen={onOpen} />
        </RovingLists>
      </ScrollArea>
      <div className="flex shrink-0 flex-col gap-px border-t border-sidebar-border p-2">
        <Button variant="ghost" className="justify-start gap-2.5 px-2 text-sm" render={<Link to="/settings" />}>
          <Settings aria-hidden className="size-3.5" />
          Settings
        </Button>
      </div>
    </aside>
  );
}
