import type { HcConnection } from "@doriface/client";
import { Button, IconButton, Kbd, StatusBar, StatusBarItem, TabBar, type WorkspaceTab } from "@doriface/ui";
import { Columns2, Folder, Monitor, PanelLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { useTabSelectKeys } from "../keys/use-tab-select-keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import { DictateButton } from "../voice/dictate-button.tsx";
import { useDictation } from "../voice/use-dictation.ts";
import { VoiceDock } from "../voice/voice-dock.tsx";
import { agentStatus, machineOf, type Session, spaceName, terminalTitle } from "./model.ts";
import { NoTerminal } from "./no-terminal.tsx";
import { usePaneSends } from "./pane-sends.ts";
import { Panes } from "./panes.tsx";
import { ReconnectStatus } from "./reconnect-status.tsx";
import { afterEnd } from "./session-actions.ts";
import { SessionMenu } from "./session-menu.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SkipLinks } from "./skip-links.tsx";
import { useAppActions, type SessionVerb } from "./use-app-actions.ts";
import { useArrivalReady, workspaceSettled } from "./use-arrival-ready.ts";
import { useFocusSidebar } from "./use-focus-sidebar.ts";
import { useSidebarShown } from "./layout-store.ts";
import type { Tabs } from "./use-tabs.ts";

const FOCUSED_TERMINAL_INPUT = '[data-focused="true"] [data-terminal] textarea';

/** The tab whose button has keyboard focus, which Move tab left/right moves instead of the active one. */
const focusedTab = (): string | null =>
  document.activeElement?.closest("[data-tab-id]")?.getAttribute("data-tab-id") ?? null;

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

const viewKey = (address: string, pid: number | null): string => `${address}#${pid ?? ""}`;

export function DesktopShell({ connection, terminals, loaded, tabs, onNew, onPalette, onSession }: DesktopShellProps) {
  const [sidebar, setSidebar] = useSidebarShown();
  const paletteKeys = useActionKeys("app.palette");
  const sidebarKeys = useActionKeys("layout.toggle:sidebar");
  const newTabKeys = useActionKeys("tab.new");
  const tabKeys = useTabSelectKeys();
  const moveLeftKeys = useActionKeys("tab.move:left");
  const moveRightKeys = useActionKeys("tab.move:right");
  const focusSidebar = useFocusSidebar(sidebar, () => setSidebar(true));
  const voice = useDictation();
  const sends = usePaneSends();
  const mic = useRef<HTMLButtonElement>(null);
  // A dictation belongs to the pane it started in: moving focus to another tab or pane ends it, typing nothing.
  const { dictation } = voice;
  useEffect(() => dictation.close(), [dictation, tabs.active]);
  // Views that showed their program had already ended (a restarted program has a new pid, so its view counts afresh).
  const [endedViews, setEndedViews] = useState<ReadonlySet<string>>(() => new Set());
  const onEnded = useCallback((address: string, pid: number | null) => {
    const key = viewKey(address, pid);
    setEndedViews((seen) => (seen.has(key) ? seen : new Set(seen).add(key)));
  }, []);
  const showsEnded = (terminal: { readonly address: string; readonly pid?: number | null }): boolean =>
    endedViews.has(viewKey(terminal.address, terminal.pid ?? null));
  useAppActions({
    terminals,
    tabs,
    onNew,
    onToggleSidebar: () => setSidebar((shown) => !shown),
    onFocusSidebar: focusSidebar,
    onSession,
    // The session in view, as the tab bar's mic acts on it; none in view (or its machine offline) leaves the key alone.
    onDictate: () => {
      const target = terminals.find((terminal) => terminal.address === tabs.active);
      if (target === undefined || target.offline === true || showsEnded(target)) return false;
      voice.toggle();
      return true;
    },
    focusedTab,
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
  // As on the phone: a focused terminal that is gone, whose machine is offline, or whose view showed it had ended has
  // nothing to type into, so a dictation under way ends (its recognizer aborted) and no mic or bound key starts one (#254, #258).
  const nothingToType =
    focusedTerminal === undefined || focusedTerminal.offline === true || showsEnded(focusedTerminal);
  useEffect(() => {
    if (nothingToType) dictation.close();
  }, [dictation, nothingToType]);
  const live = terminals.filter((terminal) => terminal.state === "live" && terminal.offline !== true);
  const blocked = live.filter((terminal) => agentStatus(terminal) === "blocked").length;
  useArrivalReady(workspaceSettled(loaded, tabs, live.length));
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
          // The strip counts the tabs it shows; `tabs.move` counts every open tab, so it is told which tab to pass.
          onMove={(id, to) => {
            const target = tabList[to]?.id;
            if (target !== undefined) tabs.move(id, tabs.open.indexOf(target));
          }}
          moveKeys={{
            ...(moveLeftKeys === undefined ? {} : { left: moveLeftKeys }),
            ...(moveRightKeys === undefined ? {} : { right: moveRightKeys }),
          }}
          moved={tabs.lastMove === null ? null : { id: tabs.lastMove.address, count: tabs.lastMove.count }}
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
              {focusedTerminal === undefined || nothingToType ? null : (
                <DictateButton voice={voice} target={terminalTitle(focusedTerminal)} size="sm" ref={mic} />
              )}
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
          onEnd={(address, end) => (closesTab(end) ? afterEnd(address, () => tabs.drop(address)) : undefined)}
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
