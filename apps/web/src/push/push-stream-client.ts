import type { ByteLink } from "@doriface/client";
import { encodePushLine, type PushClientLine, type PushHostLine, parsePushHostLine } from "@doriface/protocol";

/**
 * The device's end of the push stream: each line gets exactly one reply, in order (contract v1.7), so requests are
 * matched to replies by position. A closed stream rejects every request still waiting.
 */
export class PushStreamClient {
  readonly #link: ByteLink;
  readonly #waiting: PromiseWithResolvers<PushHostLine>[] = [];
  readonly #decoder = new TextDecoder();
  #buffer = "";
  #closed: Error | undefined;

  constructor(link: ByteLink) {
    this.#link = link;
    link.onData((bytes) => this.#data(bytes));
    link.onClose((error) => this.#end(error ?? new Error("the push stream closed")));
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  request(line: PushClientLine): Promise<PushHostLine> {
    if (this.#closed !== undefined) return Promise.reject(this.#closed);
    const reply = Promise.withResolvers<PushHostLine>();
    this.#waiting.push(reply);
    this.#link.send(new TextEncoder().encode(encodePushLine(line)));
    return reply.promise;
  }

  /** Sends a line whose reply nobody waits for (focus changes). */
  tell(line: PushClientLine): void {
    this.request(line).catch(() => undefined);
  }

  close(): void {
    this.#link.close();
    this.#end(new Error("the push stream closed"));
  }

  #data(bytes: Uint8Array): void {
    this.#buffer += this.#decoder.decode(bytes, { stream: true });
    let end = this.#buffer.indexOf("\n");
    while (end !== -1) {
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      try {
        this.#waiting.shift()?.resolve(parsePushHostLine(line));
      } catch (error) {
        this.close();
        this.#end(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      end = this.#buffer.indexOf("\n");
    }
  }

  #end(error: Error): void {
    this.#closed ??= error;
    for (const waiting of this.#waiting.splice(0)) waiting.reject(this.#closed);
  }
}
