import { type ByteLink, type InitiatorOptions, type SecureLink, secureLink, type Unsubscribe } from "@doriface/crypto";
import { ByteReader } from "./byte-reader.ts";

/** A close error carrying the WebSocket close code, the way a browser client reports it. */
export class SocketClosedError extends Error {
  readonly code: number;

  constructor(code: number, reason: string) {
    super(`socket closed with ${code} ${reason}`);
    this.code = code;
  }
}

/** A browser-style WebSocket as a ByteLink. */
function socketLink(socket: WebSocket): ByteLink {
  return {
    send: (bytes) => socket.send(bytes),
    onData(listener): Unsubscribe {
      const handle = (event: MessageEvent<unknown>): void => {
        if (event.data instanceof ArrayBuffer) listener(new Uint8Array(event.data));
      };
      socket.addEventListener("message", handle);
      return () => socket.removeEventListener("message", handle);
    },
    onClose(listener): Unsubscribe {
      const handle = (event: CloseEvent): void => listener(new SocketClosedError(event.code, event.reason));
      socket.addEventListener("close", handle);
      return () => socket.removeEventListener("close", handle);
    },
    close: (code, reason) => socket.close(code, reason),
  };
}

export interface E2eeClient {
  readonly link: SecureLink;
  readonly reader: ByteReader;
  /** Resolves with the WebSocket close code. */
  readonly closed: Promise<number>;
}

/** Dials `url` and runs the initiator handshake; rejects with the SecureLinkError (and its close code) on refusal. */
export async function openE2eeClient(url: string, options: Omit<InitiatorOptions, "role">): Promise<E2eeClient> {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`websocket to ${url} failed`)), { once: true });
  });
  const link = await secureLink(socketLink(socket), { ...options, role: "initiator" });
  const reader = new ByteReader();
  link.onData((bytes) => reader.push(bytes));
  link.onClose(() => reader.end());
  return { link, reader, closed };
}
