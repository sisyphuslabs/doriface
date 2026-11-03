import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relayDir } from "../private-relay.ts";

const READY = /Ready on (http:\/\/\S+)/;
const START_TIMEOUT_MS = 90_000;
/**
 * How long an exited wrangler's last output may take to arrive. A child that inherited its stderr (esbuild's service)
 * can outlive it and hold the pipe open, so the failure is not held until the pipes close.
 */
const EXIT_OUTPUT_MS = 2_000;
/** Each attempt binds a freshly picked HTTP port; the next attempt runs only after a proven bind race on it. */
const START_ATTEMPTS = 3;

export interface LocalRelay {
  /** e.g. `http://127.0.0.1:40123`. */
  readonly url: string;
  /** Everything wrangler printed so far, for failure messages. */
  output(): string;
  stop(): Promise<void>;
}

export interface LocalRelayOptions {
  /** For tests of this helper: picks each attempt's HTTP port, instead of a free one. */
  readonly pickPort?: () => number;
}

/** wrangler dev failed to bind the HTTP port this attempt picked: another process took it after the pick. */
class BindRace extends Error {
  readonly port: number;

  constructor(port: number, output: string) {
    super(`127.0.0.1:${port} was taken between picking it and wrangler dev binding it:\n${output}`);
    this.port = port;
  }
}

/**
 * HTTP ports are picked below every default ephemeral range (Linux 32768-60999, macOS 49152-65535). The kernel hands
 * such a port to no port-0 bind or outgoing connection, so between the pick and wrangler's bind only a process that
 * names the same port can take it.
 */
const PICK_FROM = 20_000;
const PICK_TO = 32_768;
const PICK_TRIES = 100;

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

/** A port in the pick range that nothing listens on now. */
function freePort(): number {
  for (let tries = 0; tries < PICK_TRIES; tries++) {
    const port = PICK_FROM + Math.floor(Math.random() * (PICK_TO - PICK_FROM));
    try {
      Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(true);
      return port;
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw new Error(`no free port in ${PICK_FROM}-${PICK_TO - 1} after ${PICK_TRIES} tries`);
}

/** Runs `spawn`; if it throws, the scratch directory made for it is removed before the error propagates. */
async function removingOnFailure<T>(scratch: string, spawn: () => T): Promise<T> {
  try {
    return spawn();
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Runs the relay under workerd with `wrangler dev` on ports of its own, with wrangler's state, config and logs in a
 * scratch directory. Requires Node 22+ on PATH (wrangler's own requirement). `vars` become `--var` overrides, e.g.
 * short timeouts.
 *
 * The inspector and workerd's internal and direct sockets bind port 0, so the kernel hands each a port no other
 * process holds. The HTTP port must be known before the start (`--local-upstream` names it), so it is picked free and
 * released (see `freePort`), and a process naming the same port can still take it before wrangler binds it; only that
 * failure, naming exactly the port just picked, starts another attempt on a fresh port.
 */
export async function startLocalRelay(
  vars: Readonly<Record<string, string>> = {},
  options: LocalRelayOptions = {},
): Promise<LocalRelay> {
  const pickPort = options.pickPort ?? freePort;
  const attempt = async (number: number, races: string): Promise<LocalRelay> => {
    try {
      return await startOnce(pickPort(), vars, races);
    } catch (error) {
      if (!(error instanceof BindRace) || number === START_ATTEMPTS) throw error;
      const race = `[relay-dev] 127.0.0.1:${error.port} was taken before wrangler dev bound it; retrying on a fresh port\n`;
      return attempt(number + 1, races + race);
    }
  };
  return attempt(1, "");
}

async function startOnce(
  httpPort: number,
  vars: Readonly<Record<string, string>>,
  earlier: string,
): Promise<LocalRelay> {
  const dir = relayDir();
  const wrangler = join(dir, "node_modules", ".bin", "wrangler");
  if (!existsSync(wrangler)) {
    throw new Error(
      `no installed relay checkout at ${dir}: run \`bun run relay:test\`, which fetches the private relay first`,
    );
  }
  const scratch = await mkdtemp(join(tmpdir(), "relay-"));
  const port = String(httpPort);
  const proc = await removingOnFailure(scratch, () =>
    Bun.spawn(
      [
        wrangler,
        "dev",
        "--ip",
        "127.0.0.1",
        "--port",
        port,
        "--inspector-port",
        "0",
        // Without this, wrangler rewrites request URLs to the production route, and the relay origin hosts sign over
        // would not match the address they dialed.
        "--local-upstream",
        `127.0.0.1:${port}`,
        "--persist-to",
        join(scratch, "state"),
        ...Object.entries(vars).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
      ],
      {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          XDG_CONFIG_HOME: join(scratch, "config"),
          WRANGLER_LOG_PATH: join(scratch, "logs"),
        },
      },
    ),
  );
  let output = earlier;
  const ready = Promise.withResolvers<string>();
  const bindRace = `Address already in use (127.0.0.1:${port})`;
  const failure = (code: number): Error =>
    output.includes(bindRace)
      ? new BindRace(httpPort, output)
      : new Error(`wrangler dev exited ${code} before ready:\n${output}`);
  // Both pipes are drained for the relay's whole life; a closed pipe would kill wrangler on its next write.
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
      const url = READY.exec(output)?.[1];
      if (url !== undefined) ready.resolve(url);
      // wrangler's own error naming the port just picked proves the race; its exit can lag behind it.
      if (output.includes(bindRace)) ready.reject(new BindRace(httpPort, output));
    }
  };
  const drained = Promise.all([drain(proc.stdout), drain(proc.stderr)]);
  const exited = async (): Promise<void> => {
    const code = await proc.exited;
    await Promise.race([drained, Bun.sleep(EXIT_OUTPUT_MS)]);
    ready.reject(failure(code));
  };
  void exited();
  const timer = setTimeout(
    () => ready.reject(new Error(`wrangler dev not ready in ${START_TIMEOUT_MS} ms:\n${output}`)),
    START_TIMEOUT_MS,
  );
  const stop = async (): Promise<void> => {
    proc.kill("SIGTERM");
    await proc.exited;
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    const url = await ready.promise;
    return { url, output: () => output, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
