import type { ByteLink, Unsubscribe } from "@doriface/client";

type DataListener = (bytes: Uint8Array) => void;
type CloseListener = (error: Error | undefined) => void;

/** Closed with a code the gateway or relay chose; `code` is the WebSocket close code. */
export class LinkCloseError extends Error {
  override readonly name = "LinkCloseError";
  readonly code: number;
  constructor(code: number, reason: string) {
    super(reason === "" ? `connection closed (${code})` : `${reason} (${code})`);
    this.code = code;
  }
}

function listen<T>(set: Set<T>, listener: T): Unsubscribe {
  set.add(listener);
  return () => set.delete(listener);
}

/** Opens a binary WebSocket and resolves once it is open; one message carries one chunk of bytes. */
export function openWebSocketLink(url: string, protocols: readonly string[], timeoutMs = 10_000): Promise<ByteLink> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, [...protocols]);
    socket.binaryType = "arraybuffer";
    const data = new Set<DataListener>();
    const closes = new Set<CloseListener>();
    const held: Uint8Array[] = [];
    let ended = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no answer from ${url} within ${timeoutMs} ms`));
    }, timeoutMs);

    const link: ByteLink = {
      send: (bytes) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(new Uint8Array(bytes));
      },
      onData: (listener) => {
        const off = listen(data, listener);
        for (const chunk of held.splice(0)) listener(chunk);
        return off;
      },
      onClose: (listener) => listen(closes, listener),
      close: () => socket.close(1000),
    };

    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(link);
    });
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const chunk = new Uint8Array(event.data);
      if (data.size === 0) held.push(chunk);
      for (const listener of data) listener(chunk);
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      if (ended) return;
      ended = true;
      const error = event.code === 1000 ? undefined : new LinkCloseError(event.code, event.reason);
      reject(error ?? new Error("closed before opening"));
      for (const listener of closes) listener(error);
    });
  });
}
