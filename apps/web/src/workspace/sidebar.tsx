import type { Terminal } from "@doriface/protocol";
import { IconButton, ScrollArea, SidebarFooter, SidebarFooterItem, cn } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { PanelLeft, PanelLeftOpen, Plus, Search, Settings } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { AgentLists } from "./agent-lists.tsx";
import { DEFAULT_SIDEBAR_WIDTH } from "./layout.ts";
import { useSidebarSize } from "./layout-store.ts";
import { RovingLists } from "./roving-lists.tsx";
import { SidebarEdge } from "./sidebar-edge.tsx";
import { useMachinesContext } from "./use-machines.ts";

export interface SidebarProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  readonly onHide: () => void;
  readonly onPalette: () => void;
}

/** Until it is measured, the rail's width on the web (--sidebar-rail-width, 2.75rem). */
const RAIL_PX = 44;

export function Sidebar({ terminals, active, onOpen, onHide, onPalette }: SidebarProps) {
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  const machines = useMachinesContext();
  const [{ sidebarWidth, rail }, setSize] = useSidebarSize();
  const [dragging, setDragging] = useState(false);
  const aside = useRef<HTMLElement | null>(null);
  const [railPx, setRailPx] = useState(RAIL_PX);
  useLayoutEffect(() => {
    if (rail && aside.current !== null) setRailPx(Math.round(aside.current.getBoundingClientRect().width));
  }, [rail]);
  // A width the person dragged to wins over --sidebar-width; the default leaves the token in charge.
  const style: CSSProperties | undefined =
    rail || sidebarWidth === DEFAULT_SIDEBAR_WIDTH ? undefined : { width: `${sidebarWidth}px` };
  return (
    <aside
      ref={aside}
      aria-label="Workspace"
      data-rail={rail || undefined}
      style={style}
      className={cn(
        "motion-arrive relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar [--arrive-from:none]",
        rail ? "w-(--sidebar-rail-width)" : "w-(--sidebar-width)",
        // One transition list: the arrival's opacity and transform (motion-arrive) and, unless a drag is under way, the width.
        dragging
          ? "transition-[opacity,transform] duration-(--duration-standard) ease-out"
          : "transition-[width,opacity,transform] duration-(--duration-standard) ease-out",
        "motion-reduce:transition-none motion-reduce:duration-0",
      )}
    >
      <div
        data-titlebar
        className={cn(
          "flex h-11 shrink-0 items-center gap-1",
          rail ? "justify-center" : "pr-2 pl-[var(--titlebar-inset-start,0.875rem)]",
        )}
      >
        {rail ? null : (
          <>
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
          </>
        )}
      </div>
      <ScrollArea slot="agents-list" className="flex-1">
        <RovingLists>
          <AgentLists terminals={terminals} active={active} onOpen={onOpen} rail={rail} />
        </RovingLists>
      </ScrollArea>
      <SidebarFooter rail={rail}>
        {rail ? (
          <SidebarFooterItem
            rail
            icon={<PanelLeftOpen aria-hidden />}
            label="Expand sidebar"
            onClick={() => setSize({ rail: false })}
          />
        ) : null}
        <SidebarFooterItem
          rail={rail}
          icon={<Plus aria-hidden />}
          label="Add machine"
          onClick={machines.openAddMachine}
        />
        <SidebarFooterItem
          rail={rail}
          icon={<Settings aria-hidden />}
          label="Settings"
          render={<Link to="/settings" />}
        />
      </SidebarFooter>
      <SidebarEdge width={sidebarWidth} rail={rail} railWidth={railPx} onChange={setSize} onDragging={setDragging} />
    </aside>
  );
}
