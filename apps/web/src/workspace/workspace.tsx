import type { HcConnection } from "@doriface/client";
import { useToastManager } from "@doriface/ui";
import { useCallback, useMemo, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
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
import { currentTerminal, runParamsFor } from "./new-terminal.ts";
import { useNarrow } from "./use-narrow.ts";
import { useTabs, type Tabs } from "./use-tabs.ts";
import { useTerminals } from "./use-terminals.ts";

export interface WorkspaceProps {
  readonly connection: HcConnection;
}

/** The live terminals of one core: the desktop shell from `md` up, the phone navigation below. */
export function Workspace({ connection }: WorkspaceProps) {
  const { terminals, loaded } = useTerminals(connection);
  const tabs = useTabs(connection.hello.core.id, loaded ? terminals : null);
  const narrow = useNarrow();
  const [phoneOpen, setPhoneOpen] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState<SessionAsk | null>(null);
  const [adding, setAdding] = useState(false);
  useActionHandler("app", (action) => {
    if (action !== "app.palette") return false;
    setPalette((shown) => !shown);
    return true;
  });
  const { entries, refresh, listError } = useMachines(connection, terminals);
  const { select } = tabs;
  const opened = useCallback(
    (address: string): void => {
      select(address);
      setPhoneOpen(address);
    },
    [select],
  );
  const runs = useMachineRuns(connection, opened, refresh);
  const toasts = useToastManager();
  const inView = narrow ? phoneOpen : tabs.active;
  const newTerminal = (): void => {
    const active = terminals.find((terminal) => terminal.address === inView);
    void currentTerminal((terminal) => connection.call("terminal.get", { terminal }), active)
      .then((current) => connection.call("terminal.run", runParamsFor(current)))
      .then(
        (started) => {
          opened(started.address);
          return started;
        },
        (cause: unknown) => {
          toasts.add({
            type: "error",
            title: "Could not open a new tab",
            description: connection.closed
              ? `Reconnecting to ${connection.hello.core.name}; try again once it is back.`
              : String(cause),
          });
        },
      );
  };
  const openTerminal = (address: string): void => {
    tabs.select(address);
    setPhoneOpen(address);
  };
  const onPalette = (): void => setPalette(true);
  const onSession: SessionVerb = (verb) => {
    if (inView === null) return false;
    setAsk({ kind: verb, address: inView });
    return true;
  };
  // Closing a tab of a live session asks keep or end; the dialog drops the tab itself once the session is gone.
  const desktopTabs: Tabs = { ...tabs, close: (address) => setAsk({ kind: "close", address }) };
  const done = useCallback(() => setAsk(null), []);

  const openAddMachine = useCallback(() => setAdding(true), []);
  const machines = useMemo(
    () => ({ entries, listError, openAddMachine, ...runs }),
    [entries, listError, openAddMachine, runs],
  );
  return (
    <MachinesContext value={machines}>
      <SessionContext value={setAsk}>
        {narrow ? (
          <PhoneShell
            connection={connection}
            terminals={terminals}
            open={phoneOpen}
            onOpen={setPhoneOpen}
            onBack={() => setPhoneOpen(null)}
            onNew={() => newTerminal()}
            onPalette={onPalette}
            onSession={onSession}
          />
        ) : (
          <DesktopShell
            connection={connection}
            terminals={terminals}
            loaded={loaded}
            tabs={desktopTabs}
            onNew={() => newTerminal()}
            onPalette={onPalette}
            onSession={onSession}
          />
        )}
      </SessionContext>
      <AddMachineDialog open={adding} onClose={() => setAdding(false)} />
      <SessionDialogs connection={connection} terminals={terminals} ask={ask} onDone={done} onKeep={tabs.drop} />
      {palette ? (
        <Palette
          terminals={terminals}
          host={connection.hello.core.name}
          route={connectionStore.settings.mode === "relay" ? "relay" : "loopback"}
          actions={availableActions(narrow ? "phone" : "desktop", tabs, inView !== null)}
          onOpenTerminal={openTerminal}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </MachinesContext>
  );
}
