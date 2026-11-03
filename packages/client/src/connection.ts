import {
  encodeNotification,
  encodeRequest,
  isJsonObject,
  type EmptyParams,
  type Frame,
  type HcMethod,
  type HcParams,
  type HcResult,
  type HelloResult,
  type EventsSubscribeParams,
  type JsonRpcNotification,
  type TerminalAttachParams,
} from "@doriface/protocol";
import { raceDeadline } from "./deadline.ts";
import { HcConnectionClosedError, HcHandshakeError, HcProtocolError, HcTimeoutError } from "./errors.ts";
import type { ByteLink } from "./link.ts";
import type { Unsubscribe } from "./listeners.ts";
import { EventFeed } from "./event-feed.ts";
import { TerminalStream } from "./terminal-stream.ts";
import { Wire } from "./wire.ts";

export interface HcConnectionOptions {
  /** Default 10 000 ms. */
  readonly handshakeTimeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Applied to calls that pass no `timeoutMs`. Default: none, since `terminal.wait` may block for minutes. */
  readonly callTimeoutMs?: number;
}

export interface CallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface AttachOptions extends CallOptions {
  /** Return credit as soon as output is delivered (default true). False: call `consumed(n)` after rendering. */
  readonly autoCredit?: boolean;
}

export interface SubscribeOptions extends CallOptions {
  /** Close the feed after this much silence (default 45 000 ms, three missed heartbeats); 0 disables. */
  readonly heartbeatTimeoutMs?: number;
}

/** Params may be omitted only for methods whose params are all optional. */
export type CallArgs<M extends HcMethod> = [HcParams<M>] extends [EmptyParams]
  ? readonly [params?: EmptyParams, options?: CallOptions]
  : Partial<HcParams<M>> extends HcParams<M>
    ? readonly [params?: HcParams<M>, options?: CallOptions]
    : readonly [params: HcParams<M>, options?: CallOptions];

/** Frame-level access for passthrough tooling: every incoming frame, and sending any frame. */
export interface RawFrames {
  onFrame(listener: (frame: Frame) => void): Unsubscribe;
  send(channel: number, kind: number, payload?: Uint8Array): void;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;

/** One framed herdr-core connection over a ByteLink. */
export class HcConnection {
  readonly hello: HelloResult;
  readonly features: ReadonlySet<string>;
  readonly raw: RawFrames;
  readonly #wire: Wire;
  readonly #callTimeoutMs: number | undefined;

  private constructor(wire: Wire, hello: HelloResult, callTimeoutMs: number | undefined) {
    this.#wire = wire;
    this.#callTimeoutMs = callTimeoutMs;
    this.hello = hello;
    this.features = new Set(hello.features);
    this.raw = {
      onFrame: (listener) => wire.incoming.add(listener),
      send: (channel, kind, payload) => wire.send(channel, kind, payload),
    };
  }

  /** Sends the framed `hello` and resolves once the core switched to frames. Closes the link on failure. */
  static async open(link: ByteLink, options: HcConnectionOptions = {}): Promise<HcConnection> {
    const wire = new Wire(link);
    const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    try {
      const hello = await raceDeadline(
        wire.hello,
        { timeoutMs, signal: options.signal },
        () => new HcHandshakeError(`no hello reply within ${timeoutMs} ms`),
      );
      return new HcConnection(wire, hello, options.callTimeoutMs);
    } catch (error) {
      wire.close(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /** Calls run concurrently; each resolves with its typed result or rejects with HcRpcError. */
  call<M extends HcMethod>(method: M, ...args: CallArgs<M>): Promise<HcResult<M>> {
    const [params, options] = args;
    return this.#request(method, params ?? {}, options ?? {}, (result) => result);
  }

  /** Attaches as a viewer. Kind 6 is used only when both the core and this attach path offer it. */
  attach(params: TerminalAttachParams, options: AttachOptions = {}): Promise<TerminalStream> {
    return this.#request("terminal.attach", params, options, (result) => {
      const automaticInput = this.features.has("automatic_input") && result.automatic_input === true;
      const stream = new TerminalStream(this.#wire, result, automaticInput, options.autoCredit ?? true);
      this.#wire.register(result.channel, stream);
      return stream;
    });
  }

  /** Subscribes to terminal facts: a snapshot, then ordered events on a dedicated channel. */
  subscribe(filter: EventsSubscribeParams = {}, options: SubscribeOptions = {}): Promise<EventFeed> {
    return this.#request("events.subscribe", filter, options, (result) => {
      const channel = result.channel;
      if (typeof channel !== "number") throw new HcProtocolError("events.subscribe gave no channel on a framed line");
      const snapshot = { seq: result.seq, terminals: result.terminals };
      const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
      const feed = new EventFeed(this.#wire, channel, snapshot, heartbeatTimeoutMs);
      this.#wire.register(channel, feed);
      return feed;
    });
  }

  /** `adopt` runs synchronously on the reply, before any later frame is dispatched. */
  #request<M extends HcMethod, T>(
    method: M,
    params: object,
    options: CallOptions,
    adopt: (result: HcResult<M>) => T,
  ): Promise<T> {
    if (this.#wire.isClosed) return Promise.reject(new HcConnectionClosedError("connection is closed"));
    const signal = options.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    const { id, promise } = this.#wire.calls.start((result) => {
      if (!isResultOf(method, result)) throw new HcProtocolError(`${method} replied with a non-object result`);
      return adopt(result);
    });
    this.#wire.sendRpc(encodeRequest(id, method, params));
    const timeoutMs = options.timeoutMs ?? this.#callTimeoutMs;
    return raceDeadline(
      promise,
      { timeoutMs, signal },
      () => new HcTimeoutError(method, timeoutMs ?? 0),
      () => {
        this.#wire.calls.forget(id);
        if (!this.#wire.isClosed) this.#wire.sendRpc(encodeNotification("$/cancelRequest", { id }));
      },
    );
  }

  get closed(): boolean {
    return this.#wire.isClosed;
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): Unsubscribe {
    return this.#wire.notifications.add(listener);
  }

  /** `error` is undefined after `close()`, and set when the link or the protocol failed. */
  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    if (this.#wire.isClosed) {
      const error = this.#wire.closeError;
      queueMicrotask(() => listener(error));
      return () => {};
    }
    return this.#wire.closed.add(listener);
  }

  close(): void {
    this.#wire.close();
  }
}

/** Every hc result is a JSON object; fields are not checked because cores of other versions differ. */
function isResultOf<M extends HcMethod>(_method: M, value: unknown): value is HcResult<M> {
  return isJsonObject(value);
}
