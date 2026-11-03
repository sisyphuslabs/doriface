import { join } from "node:path";
import { ByteReader } from "../../../apps/host/src/testing/byte-reader.ts";

export const HOST_CLI = join(import.meta.dir, "..", "..", "..", "apps", "host", "src", "cli.ts");

const quote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** The `doriface-host connect` line for this machine's state dir, as hc runs it: a shell command. */
export function connectCommand(stateDir: string, relayUrl: string, target: string): string {
  return [process.execPath, HOST_CLI, "connect", "--state-dir", stateDir, "--relay", relayUrl, target]
    .map(quote)
    .join(" ");
}

export interface ConnectRun {
  readonly reader: ByteReader;
  readonly exited: Promise<number>;
  stderr(): Promise<string>;
  write(bytes: Uint8Array): Promise<void>;
  end(): void;
  kill(signal: NodeJS.Signals): void;
}

export function runConnect(stateDir: string, relayUrl: string, target: string, ...extra: string[]): ConnectRun {
  const args = ["connect", "--state-dir", stateDir, "--relay", relayUrl, target, ...extra];
  const proc = Bun.spawn([process.execPath, HOST_CLI, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = new ByteReader();
  void (async () => {
    for await (const chunk of proc.stdout) reader.push(chunk);
    reader.end();
  })();
  const stderr = new Response(proc.stderr).text();
  return {
    reader,
    exited: proc.exited,
    stderr: () => stderr,
    async write(bytes) {
      proc.stdin.write(bytes);
      await proc.stdin.flush();
    },
    end() {
      void proc.stdin.end();
    },
    kill: (signal) => proc.kill(signal),
  };
}
