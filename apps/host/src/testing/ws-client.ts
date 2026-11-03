import { SUBPROTOCOL } from "../auth.ts";
import { ByteReader } from "./byte-reader.ts";

export interface WsClient {
  readonly socket: WebSocket;
  readonly reader: ByteReader;
}

/** Opens a binary WebSocket to the host with the token in the subprotocol list. */
export async function openWsClient(url: string, token: string): Promise<WsClient> {
  const socket = new WebSocket(url, [SUBPROTOCOL, `doriface.token.${token}`]);
  socket.binaryType = "arraybuffer";
  const reader = new ByteReader();
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) reader.push(new Uint8Array(event.data));
  });
  socket.addEventListener("close", () => reader.end());
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`websocket to ${url} failed`)), { once: true });
  });
  return { socket, reader };
}
