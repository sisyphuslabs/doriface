import type { ByteLink, SecureLink, Unsubscribe } from "@doriface/crypto";
import type { WebSocketLink } from "@doriface/relay-client";

/** Where decrypted bytes go: `write` is false once the sink's buffer is full, and `drained` waits for it to empty. */
export interface Output {
  write(bytes: Uint8Array): boolean;
  drained(): Promise<void>;
}

/**
 * The relay link as the record layer's ByteLink, holding further reads (and so the relay's credit) while `hold`'s
 * promise is pending: a slow reader of stdout slows the host down instead of growing this process.
 */
export class HeldLink implements ByteLink {
  readonly #link: WebSocketLink;
  #gate: Promise<void> | undefined;

  constructor(link: WebSocketLink) {
    this.#link = link;
  }

  hold(until: Promise<void>): void {
    this.#gate = until;
    void until.finally(() => {
      if (this.#gate === until) this.#gate = undefined;
    });
  }

  send(bytes: Uint8Array): void {
    this.#link.send(bytes);
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.#link.onData((bytes) => {
      listener(bytes);
      return this.#gate;
    });
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    return this.#link.onClose(listener);
  }

  close(): void {
    this.#link.close();
  }
}

export interface PipeEnds {
  readonly secure: SecureLink;
  readonly held: HeldLink;
  readonly link: WebSocketLink;
  readonly input: AsyncIterable<Uint8Array>;
  readonly output: Output;
}

/**
 * Pipes `input` into the session and the session into `output`, byte for byte, until either side ends. Resolves
 * with the error that ended the session, or undefined for a normal end: input EOF or a normal close by the host.
 */
export async function pipe(ends: PipeEnds): Promise<Error | undefined> {
  const { secure, held, link, input, output } = ends;
  const ended = Promise.withResolvers<Error | undefined>();
  secure.onData((bytes) => {
    if (!output.write(bytes)) held.hold(output.drained());
  });
  secure.onClose((error) => ended.resolve(error));
  const forward = async (): Promise<void> => {
    try {
      for await (const chunk of input) {
        secure.send(chunk);
        await link.drained();
      }
    } catch (error) {
      ended.resolve(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    secure.close();
    ended.resolve(undefined);
  };
  void forward();
  const error = await ended.promise;
  await output.drained();
  return error;
}
