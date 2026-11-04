import type { HcConnection } from "@doriface/client";
import { Button, IconButton, Kbd, StatusBar, StatusBarItem, TabBar, type WorkspaceTab } from "@doriface/ui";
import { Columns2, Folder, Monitor, PanelLeft } from "lucide-react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { useTabSelectKeys } from "../keys/use-tab-select-keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import { agentStatus, machineOf, type Session, spaceName, terminalTitle } from "./model.ts";
import { NoTerminal } from "./no-terminal.tsx";
import { Panes } from "./panes.tsx";
import { ReconnectStatus } from "./reconnect-status.tsx";
import { SessionMenu } from "./session-menu.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SkipLinks } from "./skip-links.tsx";
import { useAppActions, type SessionVerb } from "./use-app-actions.ts";
import { useArrivalReady } from "./use-arrival-ready.ts";
import { useFocusSidebar } from "./use-focus-sidebar.ts";
import { useSidebarShown } from "./layout-store.ts";
import type { Tabs } from "./use-tabs.ts";

const FOCUSED_TERMINAL_INPUT = '[data-focused="true"] [data-terminal] textarea';

export interface DesktopShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
  /** False until the core has listed its terminals; the count would read 0 until then. */
  readonly loaded: boolean;
  readonly tabs: Tabs;
  readonly onNew: () => void;
  readonly onPalette: () => void;
  readonly onSession: SessionVerb;
}

export function DesktopShell({ connection, terminals, loaded, tabs, onNew, onPalette, onSession }: DesktopShellProps) {
  const [sidebar, setSidebar] = useSidebarShown();
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  const newTabKeys = useActionKeys("tab.new");
  const tabKeys = useTabSelectKeys();
  const focusSidebar = useFocusSidebar(sidebar, () => setSidebar(true));
  useAppActions({
    terminals,
    tabs,
    onNew,
    onToggleSidebar: () => setSidebar((shown) => !shown),
    onFocusSidebar: focusSidebar,
    onSession,
  });
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  const tabList: WorkspaceTab[] = tabs.open.flatMap((address, position) => {
    const terminal = byAddress.get(address);
    if (terminal === undefined) return [];
    // tab.select:N opens tabs.open[N - 1], so the hint is read by the same position.
    const shortcut = tabKeys[position];
    const machine = machineOf(address);
    return [
      {
        id: address,
        title: terminalTitle(terminal),
        status: agentStatus(terminal),
        ...(machine === undefined ? {} : { machine }),
        ...(shortcut === undefined ? {} : { shortcut }),
      },
    ];
  });
  const focusedMachine = (tabs.active === null ? undefined : machineOf(tabs.active)) ?? connection.hello.core.name;
  const focusedTerminal = tabs.active === null ? undefined : byAddress.get(tabs.active);
  const live = terminals.filter((terminal) => terminal.state === "live" && terminal.offline !== true);
  const blocked = live.filter((terminal) => agentStatus(terminal) === "blocked").length;
  // The first screen is whole once the list has loaded and its default tab has opened (one render after `loaded`).
  useArrivalReady(loaded && (tabs.open.length > 0 || live.length === 0));
  const toggle = (
    <IconButton
      label="Split"
      icon={<Columns2 />}
      pressed={tabs.split !== null}
      disabled={tabs.open.length < 2}
      onClick={() => {
        const unsplitting = tabs.split !== null;
        tabs.toggleSplit();
        // Splitting focuses the new pane; unsplitting keeps the focused one, so keys must leave this button for it.
        if (unsplitting) document.querySelector<HTMLElement>(FOCUSED_TERMINAL_INPUT)?.focus();
      }}
    />
  );

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      <SkipLinks onSidebar={focusSidebar} />
      {sidebar ? (
        <Sidebar
          terminals={terminals}
          active={tabs.active}
          onOpen={tabs.select}
          onHide={() => setSidebar(false)}
          onPalette={onPalette}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabList}
          activeId={tabs.active ?? ""}
          {...(newTabKeys === undefined ? {} : { newTabKeys })}
          onSelect={tabs.select}
          onClose={tabs.close}
          onNew={onNew}
          {...(sidebar ? {} : { className: "pl-[var(--titlebar-inset-start,0.625rem)]" })}
          leading={
            sidebar ? null : (
              <IconButton
                label="Show sidebar"
                {...(sidebarKeys === undefined ? {} : { keys: sidebarKeys })}
                icon={<PanelLeft />}
                onClick={() => setSidebar(true)}
              />
            )
          }
          trailing={
            <>
              {focusedTerminal === undefined ? null : (
                <SessionMenu address={focusedTerminal.address} title={terminalTitle(focusedTerminal)} />
              )}
              {toggle}
            </>
          }
        />
        {tabs.open.length === 0 ? <NoTerminal onNew={onNew} /> : null}
        <Panes
          connection={connection}
          terminals={terminals}
          open={tabs.open}
          active={tabs.active}
          split={tabs.split}
          onFocus={tabs.focus}
          onEnd={(address, end) => (closesTab(end) ? tabs.drop(address) : undefined)}
        />
        <StatusBar
          start={
            <>
              {/* A terminal on another machine shows its full hc address (build-box/t3): what hc commands take. */}
              <span data-status-machine className="flex min-w-0">
                <span className="sr-only">Machine: </span>
                <StatusBarItem icon={<Monitor aria-hidden />}>
                  {tabs.active !== null && machineOf(tabs.active) !== undefined ? tabs.active : focusedMachine}
                </StatusBarItem>
              </span>
              {focusedTerminal === undefined ? null : (
                // The space gives way first, so a long name never pushes the terminal count out of the bar.
                <span data-status-space className="flex max-w-48 min-w-0">
                  <span className="sr-only">Space: </span>
                  <StatusBarItem icon={<Folder aria-hidden />}>{spaceName(focusedTerminal)}</StatusBarItem>
                </span>
              )}
              {loaded ? (
                <span className="flex shrink-0">
                  <StatusBarItem>
                    {live.length} {live.length === 1 ? "terminal" : "terminals"}
                    {blocked > 0 ? <span className="text-status-blocked-text"> · {blocked} needs you</span> : null}
                  </StatusBarItem>
                </span>
              ) : null}
              <ReconnectStatus />
            </>
          }
          end={
            <Button
              variant="ghost"
              size="sm"
              onClick={onPalette}
              className="h-5 gap-1.5 px-1 text-xs text-muted-foreground"
            >
              {paletteKeys === undefined ? null : <Kbd keys={paletteKeys} />}
              Commands
            </Button>
          }
        />
      </div>
    </div>
  );
}
