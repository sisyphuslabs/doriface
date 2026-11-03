import type { HcConnection } from "@doriface/client";
import type { TerminalRunParams } from "@doriface/protocol";
import { useToastManager } from "@doriface/ui";
import { useCallback, useMemo } from "react";
import { failureNotice, startTerminal } from "./start-on.ts";

export interface MachineRuns {
  readonly newTerminalOn: (machine: string) => void;
  /** New terminal with these run parameters, on this machine or the one `on` names. */
  readonly start: (params: TerminalRunParams) => void;
}

/**
 * New terminal anywhere: opens it, or reports the failure in a toast, the one surface every layout shows (the phone's
 * empty screen and a hidden sidebar included), and reads machine.list again in case a machine went away.
 */
export function useMachineRuns(
  connection: HcConnection,
  opened: (address: string) => void,
  refresh: () => void,
): MachineRuns {
  const toasts = useToastManager();
  const start = useCallback(
    (params: TerminalRunParams): void => {
      const core = connection.hello.core.name;
      void startTerminal((run) => connection.call("terminal.run", run), params, core).then((started) => {
        if (started.ok) return opened(started.address);
        toasts.add({ type: "error", ...failureNotice(started.failure, connection.closed, core) });
        return refresh();
      });
    },
    [connection, opened, refresh, toasts],
  );
  const newTerminalOn = useCallback((machine: string): void => start({ on: machine }), [start]);
  return useMemo(() => ({ newTerminalOn, start }), [newTerminalOn, start]);
}
