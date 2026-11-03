import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type { LocalHostEndpoint } from "../shared/bridge.ts";
import type { HostCommand } from "./host-command.ts";

export interface LocalHostOptions {
  readonly command: HostCommand;
  /** The herdr-core binary; undefined leaves doriface-host on its own default (`hc` on PATH). */
  readonly hc: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
  readonly readyTimeoutMs?: number | undefined;
}

/** doriface-host logs this line once its loopback listener is up. */
const READY_LINE = /listening on (ws:\/\/\S+?\/v1\/hc)(?:\s|$)/;
const STDERR_TAIL = 20;

/** One doriface-host child on an ephemeral loopback port, started on demand and shared by every caller. */
export class LocalHost {
  readonly #options: LocalHostOptions;
  #starting: Promise<LocalHostEndpoint> | undefined;
  #child: ChildProcess | undefined;

  constructor(options: LocalHostOptions) {
    this.#options = options;
  }

  start(): Promise<LocalHostEndpoint> {
    if (this.#starting !== undefined) return this.#starting;
    const starting: Promise<LocalHostEndpoint> = this.#spawn().catch((error: unknown) => {
      // A stop() followed by a new start() may already have replaced this attempt.
      if (this.#starting === starting) this.#starting = undefined;
      throw error;
    });
    this.#starting = starting;
    return starting;
  }

  /** Signals the child (doriface-host closes its pipes on SIGTERM) and resolves once it exits. */
  stop(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#starting = undefined;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    return exited;
  }

  #spawn(): Promise<LocalHostEndpoint> {
    const { command, hc, env, log } = this.#options;
    const token = randomBytes(32).toString("base64url");
    const args = [...command.args, "--listen", "127.0.0.1:0", ...(hc === undefined ? [] : ["--hc", hc])];
    const child = spawn(command.file, args, {
      env: { ...env, DORIFACE_HOST_TOKEN: token },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    const tail: string[] = [];
    return new Promise<LocalHostEndpoint>((resolve, reject) => {
      let ready = false;
      const fail = (reason: string): void => {
        if (ready) return;
        ready = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        reject(new Error(`doriface-host ${reason}${tail.length === 0 ? "" : `:\n${tail.join("\n")}`}`));
      };
      const timer = setTimeout(() => fail("did not start in time"), this.#options.readyTimeoutMs ?? 15_000);
      createInterface({ input: child.stderr }).on("line", (line) => {
        log(`doriface-host: ${line}`);
        tail.push(line);
        if (tail.length > STDERR_TAIL) tail.shift();
        const url = READY_LINE.exec(line)?.[1];
        if (url === undefined || ready) return;
        ready = true;
        clearTimeout(timer);
        resolve({ url, token });
      });
      child.once("error", (error) => fail(`could not start (${error.message})`));
      child.once("exit", (code, signal) => {
        fail(`exited before listening (${signal ?? `code ${String(code)}`})`);
        if (this.#child === child) {
          this.#child = undefined;
          this.#starting = undefined;
        }
        log(`doriface-host exited (${signal ?? `code ${String(code)}`})`);
      });
    });
  }
}
