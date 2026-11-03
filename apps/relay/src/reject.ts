import { newSocketPair } from "./sockets.ts";

/**
 * Accepts the upgrade and closes at once: a browser cannot read an HTTP status from a failed upgrade, so a refusal
 * is only visible to clients as a close code.
 */
export function closedSocket(code: number, reason: string): Response {
  const { client, server } = newSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}
