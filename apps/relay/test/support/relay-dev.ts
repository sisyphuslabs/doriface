import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELAY_DIR = join(import.meta.dir, "..", "..");
const READY = /Ready on (http:\/\/\S+)/;
const START_TIMEOUT_MS = 90_000;

export interface LocalRelay {
  /** e.g. `http://127.0.0.1:40123`. */
  readonly url: string;
  /** Everything wrangler printed so far, for failure messages. */
  output(): string;
  stop(): Promise<void>;
}

function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

/**
 * Runs the relay under workerd with `wrangler dev` on random ports, with wrangler's state, config and logs in a
 * scratch directory. Requires Node 22+ on PATH (wrangler's own requirement). `vars` become `--var` overrides, e.g.
 * short timeouts.
 */
export async function startLocalRelay(vars: Readonly<Record<string, string>> = {}): Promise<LocalRelay> {
  const scratch = await mkdtemp(join(tmpdir(), "relay-"));
  const wrangler = join(RELAY_DIR, "node_modules", ".bin", "wrangler");
  const port = String(freePort());
  const inspector = String(freePort());
  const proc = Bun.spawn(
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      port,
      "--inspector-port",
      inspector,
      // Without this, wrangler rewrites request URLs to the production route, and the relay origin hosts sign over
      // would not match the address they dialed.
      "--local-upstream",
      `127.0.0.1:${port}`,
      "--persist-to",
      join(scratch, "state"),
      ...Object.entries(vars).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
    ],
    {
      cwd: RELAY_DIR,
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
  );
  let output = "";
  const ready = Promise.withResolvers<string>();
  // Both pipes are drained for the relay's whole life; a closed pipe would kill wrangler on its next write.
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
      const url = READY.exec(output)?.[1];
      if (url !== undefined) ready.resolve(url);
    }
  };
  void Promise.all([drain(proc.stdout), drain(proc.stderr)]);
  void proc.exited.then((code) => ready.reject(new Error(`wrangler dev exited ${code} before ready:\n${output}`)));
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
