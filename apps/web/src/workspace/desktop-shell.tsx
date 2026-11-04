import type { HcConnection } from "@doriface/client";
import {
  type AgentStatus,
  Button,
  IconButton,
  Kbd,
  StatusBar,
  StatusBarItem,
  TabBar,
  type WorkspaceTab,
} from "@doriface/ui";
import { Columns2, Folder, Monitor, PanelLeft, Rows2 } from "lucide-react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { useTabSelectKeys } from "../keys/use-tab-select-keys.ts";
import { agentStatus, machineOf, type Session, spaceName, terminalTitle } from "./model.ts";
import { NoTerminal } from "./no-terminal.tsx";
import { panelId, SplitPanes } from "./split-panes.tsx";
import { ReconnectStatus } from "./reconnect-status.tsx";
import { SessionMenu } from "./session-menu.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SkipLinks } from "./skip-links.tsx";
import { useAppActions, type SessionVerb } from "./use-app-actions.ts";
import { useFocusSidebar } from "./use-focus-sidebar.ts";
import { useSidebarShown } from "./layout-store.ts";
import type { LayoutTab } from "./layout-model.ts";
import type { Axis } from "@doriface/protocol/layout";
import type { Layout, PaneTarget } from "./use-layout.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";

/** A tab's glyph: the state that most needs the person among its panes, as the sidebar sections rank them. */
const URGENCY: readonly AgentStatus[] = ["blocked", "done", "working", "idle", "unknown"];

function tabEntry(tab: LayoutTab, byAddress: ReadonlyMap<string, Session>, focused: string | null): WorkspaceTab {
  const shown = tab.panes.flatMap((pane) => {
    const terminal = pane.address === null ? undefined : byAddress.get(pane.address);
    return terminal === undefined ? [] : [{ pane: pane.id, terminal }];
  });
  // Like Ghostty's, an unnamed tab takes its title from the pane in focus.
  const named = shown.find((entry) => entry.pane === focused) ?? shown[0];
  const statuses = new Set(shown.map((entry) => agentStatus(entry.terminal)));
  const status = URGENCY.find((each) => statuses.has(each));
  const machine = tab.machine ?? undefined;
  return {
    id: tab.key,
    title: tab.name !== "" ? tab.name : named === undefined ? "Terminal" : terminalTitle(named.terminal),
    controls: panelId(tab.key),
    ...(status === undefined ? {} : { status }),
    ...(machine === undefined ? {} : { machine }),
  };
}

/** The tab whose button has keyboard focus, which Move tab left/right moves instead of the active one. */
const focusedTab = (): string | null =>
  document.activeElement?.closest("[data-tab-id]")?.getAttribute("data-tab-id") ?? null;

export interface DesktopShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
  /** False until the core has listed its terminals; the count would read 0 until then. */
  readonly loaded: boolean;
  readonly layout: Layout;
  readonly onNew: () => void;
  readonly onSplit: (axis: Axis, target?: PaneTarget) => void;
  readonly onCloseTab: (key: string) => void;
  readonly onClosePane: (address: string) => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly onPalette: () => void;
  readonly onSession: SessionVerb;
}

export function DesktopShell(props: DesktopShellProps) {
  const {
    connection,
    terminals,
    loaded,
    layout,
    onNew,
    onSplit,
    onCloseTab,
    onClosePane,
    onEnd,
    onPalette,
    onSession,
  } = props;
  const [sidebar, setSidebar] = useSidebarShown();
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  const newTabKeys = useActionKeys("tab.new");
  const tabKeys = useTabSelectKeys();
  const moveLeftKeys = useActionKeys("tab.move:left");
  const moveRightKeys = useActionKeys("tab.move:right");
  const focusSidebar = useFocusSidebar(sidebar, () => setSidebar(true));
  useAppActions({
    terminals,
    layout,
    onNew,
    onSplit,
    onCloseTab,
    onClosePane,
    onToggleSidebar: () => setSidebar((shown) => !shown),
    onFocusSidebar: focusSidebar,
    onSession,
    focusedTab,
  });
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  const focusedAddress = layout.focused?.address ?? null;
  const tabList: WorkspaceTab[] = layout.tabs.map((tab, position) => {
    const entry = tabEntry(tab, byAddress, tab.key === layout.active?.key ? (layout.focused?.id ?? null) : null);
    // tab.select:N selects layout.tabs[N - 1], so the hint is read by the same position.
    const shortcut = tabKeys[position];
    return shortcut === undefined ? entry : { ...entry, shortcut };
  });
  const focusedMachine =
    (focusedAddress === null ? undefined : machineOf(focusedAddress)) ?? connection.hello.core.name;
  const focusedTerminal = focusedAddress === null ? undefined : byAddress.get(focusedAddress);
  const live = terminals.filter((terminal) => terminal.state === "live" && terminal.offline !== true);
  const blocked = live.filter((terminal) => agentStatus(terminal) === "blocked").length;
  const splitRightKeys = useActionKeys("pane.split:right");
  const splitDownKeys = useActionKeys("pane.split:down");
  const cannotSplit = focusedTerminal === undefined || layout.active?.readOnly != null;
  const split = (
    <>
      <IconButton
        label="Split right"
        {...(splitRightKeys === undefined ? {} : { keys: splitRightKeys })}
        icon={<Columns2 />}
        disabled={cannotSplit}
        onClick={() => onSplit("row")}
      />
      <IconButton
        label="Split down"
        {...(splitDownKeys === undefined ? {} : { keys: splitDownKeys })}
        icon={<Rows2 />}
        disabled={cannotSplit}
        onClick={() => onSplit("column")}
      />
    </>
  );

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      <SkipLinks onSidebar={focusSidebar} />
      {sidebar ? (
        <Sidebar
          terminals={terminals}
          active={focusedAddress}
          onOpen={layout.openTerminal}
          onHide={() => setSidebar(false)}
          onPalette={onPalette}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabList}
          activeId={layout.active?.key ?? ""}
          {...(newTabKeys === undefined ? {} : { newTabKeys })}
          onSelect={layout.selectTab}
          onClose={onCloseTab}
          onNew={onNew}
          onMove={layout.moveTab}
          moveKeys={{
            ...(moveLeftKeys === undefined ? {} : { left: moveLeftKeys }),
            ...(moveRightKeys === undefined ? {} : { right: moveRightKeys }),
          }}
          moved={layout.lastMove === null ? null : { id: layout.lastMove.key, count: layout.lastMove.count }}
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
              {split}
            </>
          }
        />
        {layout.tabs.length === 0 ? <NoTerminal onNew={onNew} /> : null}
        <SplitPanes
          connection={connection}
          terminals={terminals}
          layout={layout}
          titles={new Map(tabList.map((tab) => [tab.id, tab.title]))}
          onEnd={onEnd}
          onSplit={onSplit}
          onClose={onClosePane}
        />
        <StatusBar
          start={
            <>
              {/* A terminal on another machine shows its full hc address (build-box/t3): what hc commands take. */}
              <span data-status-machine className="flex min-w-0">
                <span className="sr-only">Machine: </span>
                <StatusBarItem icon={<Monitor aria-hidden />}>
                  {focusedAddress !== null && machineOf(focusedAddress) !== undefined ? focusedAddress : focusedMachine}
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
