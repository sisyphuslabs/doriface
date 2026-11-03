import type { HcConnection } from "@doriface/client";
import type { TerminalRunParams } from "@doriface/protocol";
import { useCallback, useMemo, useState } from "react";
import { type RunFailure, type Started, startTerminal } from "./start-on.ts";

export interface MachineRuns {
  readonly newTerminalOn: (machine: string) => void;
  /** New terminal with these run parameters, on this machine or the one `on` names; a failure lands in `failure`. */
  readonly start: (params: TerminalRunParams) => void;
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
  const settle = useCallback(
    (started: Started): Started => {
      if (started.ok) opened(started.address);
      else {
        setFailure(started.failure);
        refresh();
      }
      return started;
    },
    [opened, refresh],
  );
  const start = useCallback(
    (params: TerminalRunParams): void => {
      setFailure(undefined);
      void startTerminal((run) => connection.call("terminal.run", run), params, connection.hello.core.name).then(
        settle,
      );
    },
    [connection, settle],
  );
  const newTerminalOn = useCallback((machine: string): void => start({ on: machine }), [start]);
  const dismissFailure = useCallback(() => setFailure(undefined), []);
  return useMemo(
    () => ({ newTerminalOn, start, failure, dismissFailure }),
    [newTerminalOn, start, failure, dismissFailure],
  );
}
