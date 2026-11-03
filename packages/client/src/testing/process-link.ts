import type { Subprocess } from "bun";
import { LinkClosedError, type ByteLink } from "../link.ts";
import { Listeners, type Unsubscribe } from "../listeners.ts";

/** A ByteLink over a child's stdio, e.g. `hc connect`, which pumps raw bytes to the core socket. */
export class ProcessLink implements ByteLink {
  readonly #process: Subprocess<"pipe", "pipe", "pipe">;
  readonly #data = new Listeners<Uint8Array>();
  readonly #close = new Listeners<Error | undefined>();
  #inputOpen = true;

  constructor(process: Subprocess<"pipe", "pipe", "pipe">) {
    this.#process = process;
    void this.#pump();
  }

  send(bytes: Uint8Array): void {
    if (!this.#inputOpen) throw new LinkClosedError("process stdin is closed");
    this.#process.stdin.write(bytes);
    void this.#process.stdin.flush();
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.#data.add(listener);
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    return this.#close.add(listener);
  }

  /** Ends stdin; `hc connect` then half-closes the socket and exits once the core hangs up. */
  close(): void {
    if (!this.#inputOpen) return;
    this.#inputOpen = false;
    void this.#process.stdin.end();
  }

  async #pump(): Promise<void> {
    let failure: Error | undefined;
    try {
      for await (const chunk of this.#process.stdout) this.#data.emit(chunk);
    } catch (error) {
      failure = error instanceof Error ? error : new LinkClosedError(String(error));
    }
    this.#inputOpen = false;
    const status = await this.#process.exited;
    if (failure === undefined && status !== 0) failure = new LinkClosedError(`process exited with status ${status}`);
    this.#close.emit(failure);
  }
}
