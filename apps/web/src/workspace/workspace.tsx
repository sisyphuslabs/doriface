import type { HcConnection } from "@doriface/client";
import { useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import { DesktopShell } from "./desktop-shell.tsx";
import { Palette } from "./palette.tsx";
import { availableActions } from "./shell-actions.ts";
import { PhoneShell } from "./phone-shell.tsx";
import { MachinesContext, useMachines } from "./use-machines.ts";
import { useNarrow } from "./use-narrow.ts";
import { useTabs } from "./use-tabs.ts";
import { useTerminals } from "./use-terminals.ts";

export interface WorkspaceProps {
  readonly connection: HcConnection;
}

/** The live terminals of one core: the desktop shell from `md` up, the phone navigation below. */
export function Workspace({ connection }: WorkspaceProps) {
  const { terminals } = useTerminals(connection);
  const tabs = useTabs(terminals);
  const narrow = useNarrow();
  const [phoneOpen, setPhoneOpen] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  useActionHandler("app", (action) => {
    if (action !== "app.palette") return false;
    setPalette((shown) => !shown);
    return true;
  });
  const entries = useMachines(connection, terminals);
  const newTerminal = (on?: string): void => {
    void connection.call("terminal.run", on === undefined ? {} : { on }).then((started) => {
      tabs.select(started.address);
      setPhoneOpen(started.address);
      return started;
    });
  };
  const openTerminal = (address: string): void => {
    tabs.select(address);
    setPhoneOpen(address);
  };
  const onPalette = (): void => setPalette(true);

  const machines = { entries, newTerminalOn: newTerminal };
  return (
    <MachinesContext value={machines}>
      {narrow ? (
        <PhoneShell
          connection={connection}
          terminals={terminals}
          open={phoneOpen}
          onOpen={setPhoneOpen}
          onBack={() => setPhoneOpen(null)}
          onNew={() => newTerminal()}
          onPalette={onPalette}
        />
      ) : (
        <DesktopShell
          connection={connection}
          terminals={terminals}
          tabs={tabs}
          onNew={() => newTerminal()}
          onPalette={onPalette}
        />
      )}
      {palette ? (
        <Palette
          terminals={terminals}
          host={connection.hello.core.name}
          route={connectionStore.settings.mode === "relay" ? "relay" : "loopback"}
          actions={availableActions(narrow ? "phone" : "desktop", tabs)}
          onOpenTerminal={openTerminal}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </MachinesContext>
  );
}
