import type { HcConnection } from "@doriface/client";
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
import { runParamsFor } from "./new-terminal.ts";
import { useNarrow } from "./use-narrow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";
import { useTabs, type Tabs } from "./use-tabs.ts";
import { useTerminals } from "./use-terminals.ts";
import { useNoticeOpen } from "../push/notice-open.ts";
import { usePushPresence } from "../push/use-push-presence.ts";

export interface WorkspaceProps {
  readonly connection: HcConnection;
}

/** The live terminals of one core: the desktop shell from `md` up, the phone navigation below. */
export function Workspace({ connection }: WorkspaceProps) {
  const fed = useTerminals(connection);
  const { entries, terminals, refresh, listError, views, retry, listed } = useMachines(connection, fed.terminals);
  const tabs = useTabs(connection.hello.core.id, fed.loaded ? terminals : null, views, listed);
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
  const { select } = tabs;
  const opened = useCallback(
    (address: string): void => {
      select(address);
      showOnPhone(address);
    },
    [select, showOnPhone],
  );
  const runs = useMachineRuns(connection, opened, refresh);
  const inView = narrow ? phoneOpen : tabs.active;
  const newTerminal = (): void => {
    const active = terminals.find((terminal) => terminal.address === inView);
    runs.start(runParamsFor(active));
  };
  usePushPresence(inView);
  useNoticeOpen(connectionStore.settings.mode === "relay" ? connectionStore.settings.hostId : undefined, opened);
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
          onOpenTerminal={opened}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </MachinesContext>
  );
}
