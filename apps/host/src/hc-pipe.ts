import type { Subprocess } from "bun";
import { parseHcVersionLine } from "./hc-version.ts";
import type { DataHandler, Link } from "./link.ts";
import { errnoOf, StartupError } from "./startup-error.ts";

export interface HcPipeOptions {
  readonly hc: string;
  readonly session?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly log: (line: string) => void;
}

/** One `hc connect` child as a Link: stdin and stdout carry the core's bytes, stderr goes to the log. */
export class HcPipe implements Link {
  readonly exited: Promise<number>;
  readonly #proc: Subprocess<"pipe", "pipe", "pipe">;
  readonly #log: (line: string) => void;
  readonly #closeHandlers: (() => void)[] = [];
  #reading = false;
  #closed = false;

  constructor(options: HcPipeOptions) {
    const session = options.session === undefined ? [] : ["--session", options.session];
    this.#log = options.log;
    this.#proc = Bun.spawn([options.hc, "connect", ...session], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: options.env ?? process.env,
    });
    this.exited = this.#proc.exited;
    this.#pumpLog().catch((error: unknown) => this.#log(`hc connect[${this.pid}] stderr: ${String(error)}`));
  }

  get pid(): number {
    return this.#proc.pid;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error("hc connect pipe is closed");
    this.#proc.stdin.write(bytes);
    await this.#proc.stdin.flush();
  }

  onData(handler: DataHandler): void {
    if (this.#reading) throw new Error("hc connect pipe already has a data handler");
    this.#reading = true;
    this.#pumpStdout(handler)
      .catch((error: unknown) => this.#log(`hc connect[${this.pid}] stdout: ${String(error)}`))
      .finally(() => this.close());
  }

  onClose(handler: () => void): void {
    if (this.#closed) handler();
    else this.#closeHandlers.push(handler);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    Promise.resolve()
      .then(() => this.#proc.stdin.end())
      .catch((error: unknown) => this.#log(`hc connect[${this.pid}] stdin: ${String(error)}`));
    // Signals this child only; the core it attached to lives outside this process tree and keeps running.
    this.#proc.kill();
    for (const handler of this.#closeHandlers.splice(0)) handler();
  }

  async #pumpStdout(handler: DataHandler): Promise<void> {
    const reader = this.#proc.stdout.getReader();
    const next = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done || this.#closed) return;
      await handler(value);
      return next();
    };
    return next();
  }

  async #pumpLog(): Promise<void> {
    let rest = "";
    for await (const text of this.#proc.stderr.pipeThrough(new TextDecoderStream())) {
      const lines = (rest + text).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line !== "") this.#log(`hc connect[${this.pid}]: ${line}`);
    }
    if (rest !== "") this.#log(`hc connect[${this.pid}]: ${rest}`);
  }
}

/** Why `hc` could not be run at all: not there (a path, or a bare name not on PATH), not runnable, or anything else. */
export function hcSpawnError(hc: string, error: unknown): StartupError {
  const errno = errnoOf(error);
  const reason = error instanceof Error ? error.message : String(error);
  if (errno === "ENOENT" || errno === "ENOTDIR") {
    const where = /[\\/]/.test(hc) ? `at ${hc}` : `on PATH (${hc})`;
    return new StartupError("hc-binary-missing", `herdr-core was not found ${where}`, { path: hc }, { cause: error });
  }
  if (errno === "EACCES" || errno === "EPERM") {
    return new StartupError("permission-denied", `may not run ${hc} (${reason})`, { path: hc }, { cause: error });
  }
  // Anything else (EMFILE, ETXTBSY, ...) says nothing about which program hc is, so it is no hc-version-failed.
  return new StartupError("startup-failed", `cannot run ${hc}: ${reason}`, { path: hc }, { cause: error });
}

/** Runs `hc --version` and returns the bare version, e.g. "0.1.17"; output that is not a version is hc-version-failed. */
export async function readHcVersion(hc: string): Promise<string> {
  let proc: Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([hc, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    throw hcSpawnError(hc, error);
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const version = parseHcVersionLine(out);
  if (code !== 0 || version === undefined) {
    throw new StartupError("hc-version-failed", `\`${hc} --version\` failed (exit ${code}): ${(out + err).trim()}`, {
      path: hc,
    });
  }
  return version;
}
