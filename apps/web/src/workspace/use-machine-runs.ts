import type { HcConnection } from "@doriface/client";
import { useCallback, useMemo, useState } from "react";
import { type RunFailure, startOn } from "./start-on.ts";

export interface MachineRuns {
  readonly newTerminalOn: (machine: string) => void;
  readonly failure: RunFailure | undefined;
  readonly dismissFailure: () => void;
}

/** New terminal on an added machine: opens it, or keeps hc's refusal for the list and reads machine.list again. */
export function useMachineRuns(
  connection: HcConnection,
  opened: (address: string) => void,
  refresh: () => void,
): MachineRuns {
  const [failure, setFailure] = useState<RunFailure | undefined>(undefined);
  const newTerminalOn = useCallback(
    (machine: string): void => {
      setFailure(undefined);
      startOn((params) => connection.call("terminal.run", params), machine).then(
        (started) => {
          if (started.ok) opened(started.address);
          else {
            setFailure(started.failure);
            refresh();
          }
          return started;
        },
        (error: unknown) => setFailure({ machine, kind: "connection", message: String(error) }),
      );
    },
    [connection, opened, refresh],
  );
  const dismissFailure = useCallback(() => setFailure(undefined), []);
  return useMemo(() => ({ newTerminalOn, failure, dismissFailure }), [newTerminalOn, failure, dismissFailure]);
}
