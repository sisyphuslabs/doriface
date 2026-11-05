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
import { Bot, Columns2, Folder, Monitor, PanelLeft, Rows2, SquareTerminal, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { DictateButton } from "../voice/dictate-button.tsx";
import { useDictation } from "../voice/use-dictation.ts";
import { VoiceDock } from "../voice/voice-dock.tsx";
import { agentStatus, machineOf, programKind, type Session, spaceName, terminalTitle } from "./model.ts";
import { NoTerminal } from "./no-terminal.tsx";
import { QuietBusy } from "../terminal/quiet-busy.tsx";
import { usePaneSends } from "./pane-sends.ts";
import { panelId, SplitPanes } from "./split-panes.tsx";
import { RenameDialog } from "./rename-dialog.tsx";
import { ReconnectStatus } from "./reconnect-status.tsx";
import { SessionMenu } from "./session-menu.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SkipLinks } from "./skip-links.tsx";
import { useAppActions, type SessionVerb } from "./use-app-actions.ts";
import { useArrivalReady, workspaceSettled } from "./use-arrival-ready.ts";
import { useFocusSidebar } from "./use-focus-sidebar.ts";
import { useSidebarShown, useSidebarSize } from "./layout-store.ts";
import type { LayoutTab } from "./layout-model.ts";
import type { Axis } from "@doriface/protocol/layout";
import type { Layout, PaneTarget } from "./use-layout.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";

/** A tab's glyph: the state that most needs the person among its panes, as the sidebar sections rank them. */
const URGENCY: readonly AgentStatus[] = ["blocked", "done", "working", "idle", "unknown"];

/** herdr-app's program icons for what a tab runs: an agent, a shell, or another program (its `defaults/icons`). */
const PROGRAM_ICON = {
  agent: <Bot aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
  shell: <Terminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
  program: <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
};

/**
 * A tab as herdr-app's strip draws it: its name, else its place in its space (1, 2, ...), with the icon of its agent,
 * else of its first pane's program, and the state that most needs the person among its panes. No machine label: the bar
 * shows one space's tabs, and a space is one machine's (#404, #478).
 */
function tabEntry(tab: LayoutTab, position: number, byAddress: ReadonlyMap<string, Session>): WorkspaceTab {
  const shown = tab.panes.flatMap((pane) => {
    const terminal = pane.address === null ? undefined : byAddress.get(pane.address);
    return terminal === undefined ? [] : [terminal];
  });
  const kinds = shown.map(programKind);
  const kind = kinds.includes("agent") ? "agent" : kinds[0];
  const statuses = new Set(shown.map(agentStatus));
  const status = URGENCY.find((each) => statuses.has(each));
  return {
    id: tab.key,
    title: tab.name !== "" ? tab.name : String(position + 1),
    controls: panelId(tab.key),
    ...(kind === undefined ? {} : { icon: PROGRAM_ICON[kind] }),
    ...(status === undefined ? {} : { status }),
  };
}

/** The tab whose button has keyboard focus, which Move tab left/right moves instead of the active one. */
const focusedTab = (): string | null =>
  document.activeElement?.closest("[data-tab-id]")?.getAttribute("data-tab-id") ?? null;

const FOCUSED_TERMINAL_INPUT = '[data-focused="true"] [data-terminal] textarea';

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

const viewKey = (address: string, pid: number | null): string => `${address}#${pid ?? ""}`;

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
  const [{ rail }] = useSidebarSize();
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  const newTabKeys = useActionKeys("tab.new");
  const moveLeftKeys = useActionKeys("tab.move:left");
  const moveRightKeys = useActionKeys("tab.move:right");
  const focusSidebar = useFocusSidebar(sidebar, () => setSidebar(true));
  const focusedAddress = layout.focused?.address ?? null;
  const voice = useDictation();
  const sends = usePaneSends();
  const mic = useRef<HTMLButtonElement>(null);
  // A dictation belongs to the pane it started in: moving focus to another tab or pane ends it, typing nothing.
  const { dictation } = voice;
  useEffect(() => dictation.close(), [dictation, layout.active?.key, layout.focused?.id]);
  // Views that showed their program had already ended (a restarted program has a new pid, so its view counts afresh).
  const [endedViews, setEndedViews] = useState<ReadonlySet<string>>(() => new Set());
  const onEnded = useCallback((address: string, pid: number | null) => {
    const key = viewKey(address, pid);
    setEndedViews((seen) => (seen.has(key) ? seen : new Set(seen).add(key)));
  }, []);
  const showsEnded = (terminal: { readonly address: string; readonly pid?: number | null }): boolean =>
    endedViews.has(viewKey(terminal.address, terminal.pid ?? null));
  // The tab whose Rename question is open, and how its write went.
  const [renaming, setRenaming] = useState<{ key: string; busy: boolean; error: string | null } | null>(null);
  const { renameTab } = layout;
  const submitRename = (key: string, name: string): void => {
    setRenaming({ key, busy: true, error: null });
    renameTab(key, name.trim()).then(
      () => setRenaming(null),
      (cause: unknown) =>
        setRenaming({ key, busy: false, error: cause instanceof Error ? cause.message : String(cause) }),
    );
  };
  useAppActions({
    terminals,
    layout,
    onNew,
    onSplit,
    onCloseTab,
    onClosePane,
    onRenameTab: (key) => setRenaming({ key, busy: false, error: null }),
    onToggleSidebar: () => setSidebar((shown) => !shown),
    onFocusSidebar: focusSidebar,
    onSession,
    // The session in view, as the tab bar's mic acts on it; none in view (or its machine offline) leaves the key alone.
    onDictate: () => {
      const target = terminals.find((terminal) => terminal.address === focusedAddress);
      if (target === undefined || target.offline === true || showsEnded(target)) return false;
      voice.toggle();
      return true;
    },
    focusedTab,
  });
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  const tabList: WorkspaceTab[] = layout.shown.map((tab, position) => tabEntry(tab, position, byAddress));
  const renamed = renaming === null ? undefined : layout.tabs.find((tab) => tab.key === renaming.key);
  const renamedTitle =
    renamed === undefined || renamed.name !== ""
      ? (renamed?.name ?? "tab")
      : `tab ${tabList.find((tab) => tab.id === renamed.key)?.title ?? ""}`.trim();
  const focusedMachine =
    (focusedAddress === null ? undefined : machineOf(focusedAddress)) ?? connection.hello.core.name;
  const focusedTerminal = focusedAddress === null ? undefined : byAddress.get(focusedAddress);
  // As on the phone: a focused terminal that is gone, whose machine is offline, or whose view showed it had ended has
  // nothing to type into, so a dictation under way ends (its recognizer aborted) and no mic or bound key starts one (#254, #258).
  const nothingToType =
    focusedTerminal === undefined || focusedTerminal.offline === true || showsEnded(focusedTerminal);
  useEffect(() => {
    if (nothingToType) dictation.close();
  }, [dictation, nothingToType]);
  const live = terminals.filter((terminal) => terminal.state === "live" && terminal.offline !== true);
  // As on the phone: no tabs means nothing is open only once the saved layout has answered, or once the core has listed
  // no live terminal (then there is nothing for the layout to bring back).
  const nothingOpen = layout.restored || (loaded && live.length === 0);
  const blocked = live.filter((terminal) => agentStatus(terminal) === "blocked").length;
  useArrivalReady(
    workspaceSettled(loaded, { open: layout.tabs.map((tab) => tab.key), restored: layout.restored }, live.length),
  );
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
    // --titlebar-leading: where a titlebar row's own content starts, past the window buttons, the sidebar toggle and
    // herdr-app's 12 px gap.
    <div className="relative flex h-dvh overflow-hidden bg-background [--titlebar-leading:calc(var(--titlebar-inset-start,0.5rem)+var(--control-sm)+0.75rem)]">
      <SkipLinks onSidebar={focusSidebar} />
      {sidebar ? (
        <Sidebar terminals={terminals} active={focusedAddress} onOpen={layout.openTerminal} onPalette={onPalette} />
      ) : null}
      {/* One sidebar toggle in the same place whether the sidebar is open or not, right after the window buttons (#415). It
          comes after the sidebar in the DOM so the skip links stay the first Tab stops and it is the stop just before the tabs. */}
      <div
        data-titlebar
        className="absolute top-0 left-[var(--titlebar-inset-start,0.5rem)] z-10 flex h-11 items-center"
      >
        <IconButton
          label={sidebar ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebar}
          {...(sidebarKeys === undefined ? {} : { keys: sidebarKeys })}
          icon={<PanelLeft />}
          onClick={() => setSidebar((shown) => !shown)}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabList}
          activeId={layout.active?.key ?? ""}
          {...(newTabKeys === undefined ? {} : { newTabKeys })}
          onSelect={layout.selectTab}
          onClose={onCloseTab}
          onNew={onNew}
          onRename={(key) => setRenaming({ key, busy: false, error: null })}
          onMove={layout.moveTab}
          moveKeys={{
            ...(moveLeftKeys === undefined ? {} : { left: moveLeftKeys }),
            ...(moveRightKeys === undefined ? {} : { right: moveRightKeys }),
          }}
          moved={layout.lastMove === null ? null : { id: layout.lastMove.key, count: layout.lastMove.count }}
          {...(sidebar && !rail
            ? {}
            : {
                // The tab strip starts past the sidebar toggle, which sits over it with the sidebar hidden or a rail.
                className: sidebar
                  ? "pl-[max(0.625rem,calc(var(--titlebar-leading)-var(--sidebar-rail-width)))]"
                  : "pl-(--titlebar-leading)",
              })}
          trailing={
            <>
              {focusedTerminal === undefined || nothingToType ? null : (
                <DictateButton voice={voice} target={terminalTitle(focusedTerminal)} size="sm" ref={mic} />
              )}
              {focusedTerminal === undefined ? null : (
                <SessionMenu address={focusedTerminal.address} title={terminalTitle(focusedTerminal)} />
              )}
              {split}
            </>
          }
        />
        {renaming === null || renamed === undefined ? null : (
          <RenameDialog
            key={renaming.key}
            title={renamedTitle}
            value={renamed.name}
            busy={renaming.busy}
            error={renaming.error}
            description="Every device shows the new name. Leave it empty to call the tab by its number again."
            onRename={(name) => submitRename(renaming.key, name)}
            onCancel={() => setRenaming(null)}
          />
        )}
        {layout.tabs.length > 0 ? null : nothingOpen ? (
          <NoTerminal onNew={onNew} />
        ) : (
          <QuietBusy label="Restoring your tabs" text="Restoring your tabs…" className="flex-1" />
        )}
        <SplitPanes
          connection={connection}
          terminals={terminals}
          layout={layout}
          titles={new Map(tabList.map((tab) => [tab.id, tab.title]))}
          onEnd={onEnd}
          onSplit={onSplit}
          onClose={onClosePane}
          onEnded={onEnded}
          sends={sends}
          dock={
            focusedTerminal === undefined || nothingToType ? null : (
              <VoiceDock
                voice={voice}
                target={terminalTitle(focusedTerminal)}
                onType={(text) => {
                  sends.type(focusedTerminal.address, text);
                  document.querySelector<HTMLElement>(FOCUSED_TERMINAL_INPUT)?.focus();
                }}
                onClose={() => mic.current?.focus()}
                className="pb-2"
              />
            )
          }
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
