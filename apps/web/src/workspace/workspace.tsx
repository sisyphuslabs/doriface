import type { HcConnection } from "@doriface/client";
import { useState } from "react";
import { DesktopShell } from "./desktop-shell.tsx";
import { PhoneShell } from "./phone-shell.tsx";
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
  const newTerminal = (): void => {
    void connection.call("terminal.run", {}).then((started) => {
      tabs.select(started.address);
      setPhoneOpen(started.address);
      return started;
    });
  };

  if (narrow) {
    return (
      <PhoneShell
        connection={connection}
        terminals={terminals}
        open={phoneOpen}
        onOpen={setPhoneOpen}
        onBack={() => setPhoneOpen(null)}
        onNew={newTerminal}
      />
    );
  }
  return <DesktopShell connection={connection} terminals={terminals} tabs={tabs} onNew={newTerminal} />;
}
