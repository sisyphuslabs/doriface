import type { HcConnection } from "@doriface/client";
import { useToastManager } from "@doriface/ui";
import { useCallback, useMemo, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import { type Axis, LAYOUT_DOC } from "@doriface/protocol/layout";
import { closesTab, type TerminalEnd } from "../terminal/terminal-end.ts";
import { CloseTabDialog } from "./close-tab-dialog.tsx";
import { AddMachineDialog } from "./add-machine-dialog.tsx";
import { DesktopShell } from "./desktop-shell.tsx";
import { Palette } from "./palette.tsx";
import { SessionContext, type SessionAsk } from "./session-context.ts";
import { SessionDialogs } from "./session-dialogs.tsx";
import { availableActions } from "./shell-actions.ts";
import { PhoneShell } from "./phone-shell.tsx";
import type { SessionVerb } from "./use-app-actions.ts";
import { useMachineRuns } from "./use-machine-runs.ts";
import { MachinesContext, useMachines } from "./use-machines.ts";
import { runParamsFor } from "./new-terminal.ts";
import { useNarrow } from "./use-narrow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";
import { findTerminal } from "./layout-model.ts";
import { useLayout, type PaneTarget } from "./use-layout.ts";
import { useLayoutDocs } from "./use-layout-docs.ts";
import { useTerminals, type DocHeard } from "./use-terminals.ts";

export interface WorkspaceProps {
  readonly connection: HcConnection;
}

/** The live terminals of one core: the desktop shell from `md` up, the phone navigation below. */
export function Workspace({ connection }: WorkspaceProps) {
  // The feed comes before the machine list the layout documents need, so its doc events reach them through a ref.
  const heardLayout = useRef<(machine: string | null, version: number) => void>(() => undefined);
  const onDoc = useCallback<DocHeard>((machine, name, version) => {
    if (name === LAYOUT_DOC) heardLayout.current(machine, version);
  }, []);
  const fed = useTerminals(connection, onDoc);
  const { entries, terminals, refresh, listError, views, retry } = useMachines(connection, fed.terminals);
  const { layouts, heard } = useLayoutDocs(connection, views);
  heardLayout.current = heard;
  const toasts = useToastManager();
  const failed = useCallback(
    (message: string) => toasts.add({ type: "error", title: "The layout was not saved", description: message }),
    [toasts],
  );
  const told = useCallback((message: string) => toasts.add({ type: "info", title: message }), [toasts]);
  const layout = useLayout(connection.hello.core.id, layouts, fed.loaded ? terminals : [], failed, told);
  const narrow = useNarrow();
  const ids = useMemo(() => machineIds(views), [views]);
  // The phone's open terminal is kept by machine id like a tab, so a rename keeps it open at the new address.
  const [phoneKey, setPhoneKey] = useState<string | null>(null);
  const phoneOpen = phoneKey === null ? null : (tabAddress(phoneKey, ids) ?? null);
  const showOnPhone = useCallback((address: string) => setPhoneKey(tabKey(address, ids)), [ids]);
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState<SessionAsk | null>(null);
  const [adding, setAdding] = useState(false);
  useActionHandler("app", (action) => {
    if (action !== "app.palette") return false;
    setPalette((shown) => !shown);
    return true;
  });
  const { openTerminal: openInLayout } = layout;
  const opened = useCallback(
    (address: string): void => {
      openInLayout(address);
      showOnPhone(address);
    },
    [openInLayout, showOnPhone],
  );
  const [closingTab, setClosingTab] = useState<string | null>(null);
  const runs = useMachineRuns(connection, opened, refresh);
  const inView = narrow ? phoneOpen : (layout.focused?.address ?? null);
  const newTerminal = (): void => runs.start(runParamsFor(terminals.find((terminal) => terminal.address === inView)));
  const split = (axis: Axis, target?: PaneTarget): void => {
    const from =
      target === undefined
        ? inView
        : layout.tabs.find((tab) => tab.key === target.tab)?.panes.find((pane) => pane.id === target.pane)?.address;
    const near = terminals.find((terminal) => terminal.address === from);
    runs.start(runParamsFor(near), (address) => layout.split(axis, address, target));
  };
  const openTerminal = (address: string): void => {
    layout.openTerminal(address);
    showOnPhone(address);
  };
  const closeTab = (key: string): void => {
    const tab = layout.tabs.find((each) => each.key === key);
    const shown = tab?.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])) ?? [];
    const [only] = shown;
    if (shown.length === 1 && only !== undefined) setAsk({ kind: "close", address: only });
    else if (shown.length > 1) setClosingTab(key);
    else layout.closeTab(key);
  };
  const onEnd = (address: string, end: TerminalEnd): void => {
    if (closesTab(end)) layout.dropPane(address);
  };
  const closing = layout.tabs.find((tab) => tab.key === closingTab);
  const phoneTab = phoneOpen === null ? null : findTerminal(layout.tabs, phoneOpen);
  const phonePanes = phoneTab?.tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])) ?? [];
  const onPalette = (): void => setPalette(true);
  const onSession: SessionVerb = (verb) => {
    if (inView === null) return false;
    setAsk({ kind: verb, address: inView });
    return true;
  };
  const done = useCallback(() => setAsk(null), []);

  const openAddMachine = useCallback(() => setAdding(true), []);
  const machines = useMemo(
    () => ({ entries, listError, openAddMachine, views, retry, ...runs }),
    [entries, listError, openAddMachine, views, retry, runs],
  );
  return (
    <MachinesContext value={machines}>
      <SessionContext value={setAsk}>
        {narrow ? (
          <PhoneShell
            connection={connection}
            terminals={terminals}
            open={phoneOpen}
            panes={phonePanes}
            onOpen={showOnPhone}
            onBack={() => setPhoneKey(null)}
            onNew={() => newTerminal()}
            onPalette={onPalette}
            onSession={onSession}
          />
        ) : (
          <DesktopShell
            connection={connection}
            terminals={terminals}
            loaded={fed.loaded}
            layout={layout}
            onNew={() => newTerminal()}
            onSplit={split}
            onCloseTab={closeTab}
            onClosePane={(address) => setAsk({ kind: "close", address })}
            onEnd={onEnd}
            onPalette={onPalette}
            onSession={onSession}
          />
        )}
      </SessionContext>
      <AddMachineDialog open={adding} onClose={() => setAdding(false)} />
      <SessionDialogs connection={connection} terminals={terminals} ask={ask} onDone={done} onKeep={layout.dropPane} />
      {closing === undefined ? null : (
        <CloseTabDialog
          connection={connection}
          terminals={terminals}
          tab={closing}
          onKeep={() => layout.closeTab(closing.key)}
          onDone={() => setClosingTab(null)}
        />
      )}
      {palette ? (
        <Palette
          terminals={terminals}
          host={connection.hello.core.name}
          route={connectionStore.settings.mode === "relay" ? "relay" : "loopback"}
          actions={availableActions(narrow ? "phone" : "desktop", inView !== null, layout.active?.readOnly ?? null)}
          onOpenTerminal={openTerminal}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </MachinesContext>
  );
}
