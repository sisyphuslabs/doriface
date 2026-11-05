import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKER = join(import.meta.dir, "lock-step-worker.ts");

/** Leaves `content` as the lock file v0.1.0 kept at `state.lock`, as a state dir upgraded from it has it. */
export function legacyStateLock(stateDir: string, content: string): void {
  rmSync(join(stateDir, "state.lock"), { recursive: true, force: true });
  writeFileSync(join(stateDir, "state.lock"), content);
}

/** The content ("<pid> <token>") of the state lock's highest generation, or undefined while nobody holds it. */
export function stateLockHolder(stateDir: string): string | undefined {
  const lock = join(stateDir, "state.lock");
  const top = Math.max(
    0,
    ...readdirSync(lock)
      .filter((name) => /^[1-9][0-9]*$/.test(name))
      .map(Number),
  );
  const content = top === 0 ? undefined : readFileSync(join(lock, String(top)), "utf8");
  return content === "free" ? undefined : content;
}

/**
 * Lock-step-worker processes on one state dir, each stopped at a step of the lock protocol until the test lets it go,
 * so a test runs an exact interleaving of real processes. Every step any of them reports is checked against the others:
 * `maxHolders` is the most processes that were ever between "acquired" and "released" at once.
 */
export class LockSteps {
  readonly #dir: string;
  readonly #holders = new Set<string>();
  readonly #workers: StepWorker[] = [];
  #maxHolders = 0;

  constructor(dir: string) {
    this.#dir = dir;
  }

  get maxHolders(): number {
    return this.#maxHolders;
  }

  /** Starts a worker; its first step is read with `next`. */
  spawn(name: string): StepWorker {
    const worker = new StepWorker(name, this.#dir, (line) => this.#saw(name, line));
    this.#workers.push(worker);
    return worker;
  }

  async stop(): Promise<void> {
    await Promise.all(this.#workers.map((worker) => worker.kill()));
  }

  #saw(name: string, line: string): void {
    const [step] = line.split(" ");
    if (step === "acquired") this.#holders.add(name);
    if (step === "released" || step === "done" || step === "killed") this.#holders.delete(name);
    this.#maxHolders = Math.max(this.#maxHolders, this.#holders.size);
  }
}

export class StepWorker {
  readonly name: string;
  readonly #process;
  readonly #lines: string[] = [];
  readonly #onLine: (line: string) => void;
  #waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | undefined;
  #ended = false;

  constructor(name: string, dir: string, onLine: (line: string) => void) {
    this.name = name;
    this.#onLine = onLine;
    this.#process = Bun.spawn([process.execPath, WORKER, dir], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    void this.#read();
  }

  /** The next step this worker stops at (or "done"). */
  next(): Promise<string> {
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.#ended) return Promise.reject(new Error(`${this.name} exited`));
    return new Promise((resolve, reject) => (this.#waiting = { resolve, reject }));
  }

  /** Lets this worker past the step it is stopped at and returns the next one. */
  go(): Promise<string> {
    void this.#process.stdin.write("g");
    void this.#process.stdin.flush();
    return this.next();
  }

  /** SIGKILLs the worker wherever it is stopped: a crash at that step. */
  async kill(): Promise<void> {
    this.#process.kill("SIGKILL");
    await this.#process.exited;
    this.#onLine("killed");
  }

  async #read(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of this.#process.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        this.#deliver(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    }
    this.#ended = true;
    const stderr = await new Response(this.#process.stderr).text();
    this.#waiting?.reject(new Error(`${this.name} exited: ${stderr}`));
    this.#waiting = undefined;
  }

  #deliver(line: string): void {
    this.#onLine(line);
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (waiting === undefined) this.#lines.push(line);
    else waiting.resolve(line);
  }
}
