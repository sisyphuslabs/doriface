import type { HcConnection } from "@doriface/client";
import type { Terminal, TerminalKillParams, TerminalLabelParams, TerminalRmParams } from "@doriface/protocol";

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

/** Ends the program (hangup, then terminate, then kill) and removes the finished terminal from hc. */
export async function endSession(calls: SessionCalls, address: string): Promise<void> {
  const ended = await calls.kill({ terminal: address });
  if (ended.state === "finished") await calls.rm({ terminal: address });
}
