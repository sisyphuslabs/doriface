import type { Socket, UnixSocketListener } from "bun";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type ControlRequest, parseRequest } from "./control-requests.ts";

/**
 * A Unix socket in the state dir (0700) through which `doriface-host pair` and `devices revoke` reach the running
 * host: one JSON request line, one JSON reply line. Without a running host the commands fall back to the files.
 */
export const controlSocketPath = (stateDir: string): string => join(stateDir, "host.sock");

export type { ControlRequest } from "./control-requests.ts";

/** `closed` aborts when the requesting connection goes away, so a long wait (`mesh-pending`) can stop. */
export type ControlHandler = (request: ControlRequest, closed: AbortSignal) => Promise<unknown>;

/** A request is one short JSON line; anything longer without a newline is refused. */
const MAX_REQUEST_BYTES = 4096;

interface ConnectionState {
  buffer: string;
  readonly closed: AbortController;
}

export interface ControlListener {
  /** Stops listening and removes the socket file. */
  stop(): void;
}

/** Whether a running host answers on this state dir's control socket (a stale socket file refuses connections). */
export async function controlIsLive(stateDir: string): Promise<boolean> {
  try {
    const socket = await Bun.connect({ unix: controlSocketPath(stateDir), socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** Listens on the state dir's socket, replacing a stale file; check {@link controlIsLive} first. */
export function listenControl(stateDir: string, handle: ControlHandler): ControlListener {
  const unix = controlSocketPath(stateDir);
  rmSync(unix, { force: true });
  const reply = (socket: Socket<ConnectionState>, value: unknown): void => {
    socket.end(`${JSON.stringify(value)}\n`);
  };
  const listener: UnixSocketListener<ConnectionState> = Bun.listen<ConnectionState>({
    unix,
    socket: {
      open(socket) {
        socket.data = { buffer: "", closed: new AbortController() };
      },
      close(socket) {
        socket.data.closed.abort(new Error("the control connection closed"));
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        const newline = socket.data.buffer.indexOf("\n");
        if (newline === -1) {
          if (socket.data.buffer.length > MAX_REQUEST_BYTES) {
            socket.data.buffer = "";
            reply(socket, { ok: false, error: "request too large" });
          }
          return;
        }
        const line = socket.data.buffer.slice(0, newline);
        Promise.resolve()
          .then(() => handle(parseRequest(line), socket.data.closed.signal))
          .then(
            (result) => reply(socket, { ok: true, result }),
            (error: unknown) =>
              reply(socket, { ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
      },
    },
  });
  return {
    stop() {
      listener.stop(true);
      rmSync(unix, { force: true });
    },
  };
}

/** Sends one request to the running host; resolves undefined when no host listens on this state dir. */
export async function requestControl(stateDir: string, request: ControlRequest): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let text = "";
  try {
    await Bun.connect({
      unix: controlSocketPath(stateDir),
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(request)}\n`);
        },
        data(_, chunk) {
          text += chunk.toString();
        },
        close() {
          resolve(text);
        },
        error(_, error) {
          reject(error);
        },
      },
    });
  } catch {
    return undefined;
  }
  const answer: unknown = JSON.parse(await promise);
  if (typeof answer !== "object" || answer === null || !("ok" in answer)) throw new Error("bad control reply");
  if (answer.ok !== true)
    throw new Error(`the running host refused: ${"error" in answer ? String(answer.error) : "?"}`);
  return "result" in answer ? answer.result : undefined;
}
