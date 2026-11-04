import type { HcConnection } from "@doriface/client";
import {
  HcRpcError,
  type Terminal,
  type TerminalKillParams,
  type TerminalLabelParams,
  type TerminalRmParams,
} from "@doriface/protocol";

/**
 * The label a renamed session carries; terminalTitle reads it before hc's name and the program's title. herdr-app's
 * label rules (docs/labels.md, "Adding more") put state clients share in a herdr.-prefixed label, so every herdr
 * client can read it and a bare key cannot collide with a user's or an agent's own labels (D22).
 */
export const TITLE_LABEL = "herdr.name";

/** The hc calls a session action makes. */
export interface SessionCalls {
  readonly label: (params: TerminalLabelParams) => Promise<unknown>;
  readonly kill: (params: TerminalKillParams) => Promise<Pick<Terminal, "state">>;
  readonly rm: (params: TerminalRmParams) => Promise<unknown>;
}

export function sessionCalls(connection: HcConnection): SessionCalls {
  return {
    label: (params) => connection.call("terminal.label", params),
    kill: (params) => connection.call("terminal.kill", params),
    rm: (params) => connection.call("terminal.rm", params),
  };
}

/** Names a session for every client: a label on the terminal, or no label when the name is cleared. */
export async function renameSession(calls: SessionCalls, address: string, name: string): Promise<void> {
  await calls.label({ terminal: address, labels: { [TITLE_LABEL]: name.trim() } });
}

/**
 * Ends in flight, by address. An End belongs to the session, not to the screen that asked for it: the program's exit
 * closes that screen before End's terminal.rm goes out, and a page closed then would leave the terminal finished.
 */
const ending = new Map<string, Promise<void>>();

async function killAndRemove(calls: SessionCalls, address: string): Promise<void> {
  try {
    const ended = await calls.kill({ terminal: address });
    if (ended.state === "finished") await calls.rm({ terminal: address });
  } catch (cause) {
    // Removed meanwhile (another client, or an earlier attempt's removal arriving late): the terminal is gone, which is
    // what End is for.
    if (!(cause instanceof HcRpcError && cause.kind === "not_found")) throw cause;
  }
}

/** Ends the program (hangup, then terminate, then kill) and removes the finished terminal from hc. */
export function endSession(calls: SessionCalls, address: string): Promise<void> {
  const run = killAndRemove(calls, address);
  ending.set(address, run);
  const settle = (): void => {
    if (ending.get(address) === run) ending.delete(address);
  };
  run.then(settle, settle);
  return run;
}

/** Runs `then` once no End of this session is in flight: at once, or when that End has removed the terminal or failed. */
export function afterEnd(address: string, then: () => void): void {
  const run = ending.get(address);
  if (run === undefined) then();
  else run.then(then, then);
}
