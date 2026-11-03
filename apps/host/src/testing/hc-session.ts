import { encodeFrame, FrameKind, RPC_CHANNEL } from "@doriface/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ByteReader } from "./byte-reader.ts";

const encoder = new TextEncoder();

/** The first line every framed client sends. */
export const HELLO = encoder.encode('{"jsonrpc":"2.0","id":0,"method":"hello","params":{"framed":true}}\n');

export function rpcFrame(id: number, method: string): Uint8Array {
  return encodeFrame(RPC_CHANNEL, FrameKind.Data, encoder.encode(JSON.stringify({ jsonrpc: "2.0", id, method })));
}

export function resolveHcBin(): string {
  const bin = process.env["HC_BIN"] || Bun.which("hc");
  if (bin === null || bin === undefined || bin === "") {
    throw new Error("herdr-core is required: set HC_BIN to an hc 0.1.17 binary or put hc on PATH");
  }
  return bin;
}

export interface HcSession {
  readonly hc: string;
  readonly name: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Spawns `hc connect --session <name>` directly, with its stdout fed to `reader`. */
  connect(): DirectConnection;
  /** Stops this session's core and deletes its state. */
  dispose(): Promise<void>;
}

export interface DirectConnection {
  readonly reader: ByteReader;
  readonly exited: Promise<number>;
  write(bytes: Uint8Array): Promise<void>;
  end(): void;
}

/** A scratch hc session: its own core, state dir and socket under $TMPDIR. */
export function createHcSession(prefix: string): HcSession {
  const hc = resolveHcBin();
  const dir = mkdtempSync(join(tmpdir(), "dh-"));
  const name = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  const env = {
    ...process.env,
    HC_SESSION: name,
    XDG_STATE_HOME: join(dir, "state"),
    XDG_RUNTIME_DIR: join(dir, "run"),
    // A deep $TMPDIR (macOS) pushes the default socket path past the 103-byte sun_path limit.
    HC_SOCKET: join(dir, "c.sock"),
  };
  const connect = (): DirectConnection => {
    const proc = Bun.spawn([hc, "connect", "--session", name], {
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = new ByteReader();
    const pump = async (source: ReadableStream<Uint8Array>): Promise<void> => {
      for await (const chunk of source) reader.push(chunk);
      reader.end();
    };
    void pump(proc.stdout);
    return {
      reader,
      exited: proc.exited,
      async write(bytes) {
        proc.stdin.write(bytes);
        await proc.stdin.flush();
      },
      end() {
        void proc.stdin.end();
      },
    };
  };
  const dispose = async (): Promise<void> => {
    const control = connect();
    await control.write(encoder.encode('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n'));
    await control.reader.line();
    control.end();
    // The core closes the connection as it shuts down, which ends this hc connect.
    await control.exited;
    rmSync(dir, { recursive: true, force: true });
  };
  return { hc, name, env, connect, dispose };
}
