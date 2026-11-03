import type { HcConnection } from "@doriface/client";

/** The label a renamed session carries; terminalTitle reads it before hc's name and the program's title. */
export const TITLE_LABEL = "title";

type SessionCalls = Pick<HcConnection, "call">;

/** Names a session for every client: a label on the terminal, or no label when the name is cleared. */
export async function renameSession(connection: SessionCalls, address: string, name: string): Promise<void> {
  await connection.call("terminal.label", { terminal: address, labels: { [TITLE_LABEL]: name.trim() } });
}

/** Ends the program (hangup, then terminate, then kill) and removes the finished terminal from hc. */
export async function endSession(connection: SessionCalls, address: string): Promise<void> {
  const ended = await connection.call("terminal.kill", { terminal: address });
  if (ended.state === "finished") await connection.call("terminal.rm", { terminal: address });
}
