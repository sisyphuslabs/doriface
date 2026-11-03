import { concatBytes } from "@doriface/crypto";
import { connect, type Socket } from "node:net";
import { WsLink, type WsLinkOptions } from "../ws-link.ts";

export interface WsLinkServer {
  readonly port: number;
  nextLink(): Promise<WsLink<undefined>>;
  stop(): Promise<void>;
}

/** A real Bun.serve whose websocket handler wraps each socket in a WsLink, exactly as the gateway does. */
export function serveWsLinks(options: WsLinkOptions & { readonly backpressureLimit?: number } = {}): WsLinkServer {
  const links = new WeakMap<object, WsLink<undefined>>();
  const waiting: ((link: WsLink<undefined>) => void)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, bun) => (bun.upgrade(request) ? undefined : new Response("upgrade required", { status: 426 })),
    websocket: {
      perMessageDeflate: false,
      ...(options.backpressureLimit === undefined ? {} : { backpressureLimit: options.backpressureLimit }),
      closeOnBackpressureLimit: false,
      open(ws) {
        const link = new WsLink(ws, options);
        links.set(ws, link);
        waiting.shift()?.(link);
      },
      message: (ws, message) => links.get(ws)?.receive(message),
      drain: (ws) => links.get(ws)?.drained(),
      close: (ws) => links.get(ws)?.peerClosed(),
    },
  });
  return {
    port: server.port ?? 0,
    nextLink: () => new Promise((resolve) => waiting.push(resolve)),
    stop: () => server.stop(true),
  };
}

/** A client frame: FIN, the opcode, the mask bit with the payload length, a mask key and the masked payload. */
function clientFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const long = payload.byteLength >= 126;
  const header = long
    ? Uint8Array.of(0x80 | opcode, 0x80 | 126, payload.byteLength >> 8, payload.byteLength & 0xff)
    : Uint8Array.of(0x80 | opcode, 0x80 | payload.byteLength);
  const mask = crypto.getRandomValues(new Uint8Array(4));
  const masked = payload.map((byte, i) => byte ^ (mask[i % 4] ?? 0));
  const frame = new Uint8Array(header.byteLength + 4 + masked.byteLength);
  frame.set(header);
  frame.set(mask, header.byteLength);
  frame.set(masked, header.byteLength + 4);
  return frame;
}

/** A raw WebSocket client over node:net, so a test can stop reading and make the server's sends back up. */
export interface RawWsClient {
  readonly socket: Socket;
  sendText(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  /** Every byte received after the 101 response (server frames are unmasked). */
  readonly received: () => Uint8Array;
}

export async function rawWsClient(port: number): Promise<RawWsClient> {
  const socket = connect(port, "127.0.0.1");
  const chunks: Uint8Array[] = [];
  const upgraded = Promise.withResolvers<void>();
  let header = "";
  socket.on("data", (chunk: Buffer) => {
    if (header.includes("\r\n\r\n")) return void chunks.push(new Uint8Array(chunk));
    header += chunk.toString("latin1");
    const end = header.indexOf("\r\n\r\n");
    if (end === -1) return;
    if (!header.startsWith("HTTP/1.1 101")) return upgraded.reject(new Error(`no upgrade: ${header.split("\r\n")[0]}`));
    chunks.push(new Uint8Array(Buffer.from(header.slice(end + 4), "latin1")));
    upgraded.resolve();
  });
  socket.on("error", (error) => upgraded.reject(error));
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  socket.write(
    `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await upgraded.promise;
  return {
    socket,
    sendText: (text) => socket.write(clientFrame(0x1, new TextEncoder().encode(text))),
    sendBinary: (bytes) => socket.write(clientFrame(0x2, bytes)),
    received: () => concatBytes(...chunks),
  };
}
