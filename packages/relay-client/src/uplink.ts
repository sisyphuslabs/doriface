import { backoffDelay } from "./backoff.ts";
import { SessionLink } from "./session-link.ts";
import type { HostSigner } from "./signer.ts";
import { type CreateSocket, defaultCreateSocket, isOpen, relaySocketUrl } from "./socket.ts";
import {
  authMessage,
  CHALLENGE_BYTES,
  CloseCode,
  decodeMux,
  encodeAuthAnswer,
  hostIdOf,
  MuxError,
  MuxType,
} from "./wire/index.ts";

export type UplinkState =
  | { readonly state: "connecting"; readonly attempt: number }
  /** The challenge answer is sent; the relay closes with 4403 if it is wrong. */
  | { readonly state: "answered" }
  | { readonly state: "waiting"; readonly code: number; readonly retryInMs: number }
  | { readonly state: "stopped"; readonly code: number };

export interface UplinkOptions {
  /** e.g. `https://relay-doriface.omo.dev`. */
  readonly relayUrl: string;
  readonly signer: HostSigner;
  /** Called for every client session the relay opens; the link ends when the client leaves or the uplink drops. */
  readonly onSession: (session: SessionLink) => void;
  readonly onState?: (state: UplinkState) => void;
  readonly createSocket?: CreateSocket;
  readonly random?: () => number;
}

/** Reconnecting cannot fix these: the key is wrong, or another uplink for this host took over. */
const FINAL_CODES: ReadonlySet<number> = new Set([CloseCode.RelayAuthFailed, CloseCode.UplinkReplaced]);
/** An uplink that stayed up this long after answering starts the next backoff from the bottom again. */
const STABLE_MS = 30_000;

/** The host's one connection to the relay, carrying every client session multiplexed by sessionId. */
export class Uplink {
  readonly hostId: string;
  /** Resolves with the close code once the uplink stops for good: `stop()`, 4403 or 4409. */
  readonly stopped: Promise<number>;
  readonly #options: UplinkOptions;
  readonly #url: string;
  readonly #sessions = new Map<number, SessionLink>();
  readonly #stop = Promise.withResolvers<number>();
  #socket: WebSocket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #answeredAt: number | undefined;
  #done = false;

  private constructor(hostId: string, options: UplinkOptions) {
    this.hostId = hostId;
    this.#options = options;
    this.#url = relaySocketUrl(options.relayUrl, `/v1/host/${hostId}`);
    this.stopped = this.#stop.promise;
  }

  static async start(options: UplinkOptions): Promise<Uplink> {
    const uplink = new Uplink(await hostIdOf(options.signer.publicKey), options);
    uplink.#connect();
    return uplink;
  }

  /** Closes the uplink and every session on it, and stops reconnecting. */
  stop(): void {
    this.#finish(CloseCode.Normal);
  }

  #connect(): void {
    this.#timer = undefined;
    this.#answeredAt = undefined;
    this.#options.onState?.({ state: "connecting", attempt: this.#attempt });
    const ws = (this.#options.createSocket ?? defaultCreateSocket)(this.#url);
    ws.binaryType = "arraybuffer";
    this.#socket = ws;
    let challenged = false;
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return ws.close(CloseCode.UnsupportedData, "binary messages only");
      const bytes = new Uint8Array(event.data);
      if (challenged) return this.#frame(ws, bytes);
      challenged = true;
      this.#answer(ws, bytes).catch(() => ws.close(CloseCode.InternalError, "signing failed"));
    });
    ws.addEventListener("close", (event: CloseEvent) => this.#lost(ws, event.code));
  }

  async #answer(ws: WebSocket, challenge: Uint8Array): Promise<void> {
    if (challenge.byteLength !== CHALLENGE_BYTES) return ws.close(CloseCode.ProtocolError, "bad challenge");
    const { signer } = this.#options;
    const signature = await signer.sign(authMessage(this.hostId, challenge));
    if (!isOpen(ws)) return;
    ws.send(encodeAuthAnswer(signer.publicKey, signature));
    this.#answeredAt = Date.now();
    this.#options.onState?.({ state: "answered" });
  }

  #frame(ws: WebSocket, bytes: Uint8Array): void {
    let frame;
    try {
      frame = decodeMux(bytes);
    } catch (error) {
      if (error instanceof MuxError) return ws.close(CloseCode.ProtocolError, error.message);
      throw error;
    }
    const session = this.#sessions.get(frame.sessionId);
    if (frame.type === MuxType.Data) return session?.deliver(frame.payload);
    if (frame.type === MuxType.Close) return session?.ended(frame.code);
    if (session !== undefined) return ws.close(CloseCode.ProtocolError, `session ${frame.sessionId} is already open`);
    const link = new SessionLink(frame.sessionId, {
      sendFrame: (out) => {
        if (isOpen(ws)) ws.send(out);
      },
      release: (sessionId) => this.#sessions.delete(sessionId),
    });
    this.#sessions.set(frame.sessionId, link);
    this.#options.onSession(link);
  }

  #lost(ws: WebSocket, code: number): void {
    if (ws !== this.#socket) return;
    this.#socket = undefined;
    this.#endSessions(code);
    if (this.#done) return;
    if (FINAL_CODES.has(code)) return this.#finish(code);
    const stable = this.#answeredAt !== undefined && Date.now() - this.#answeredAt >= STABLE_MS;
    if (stable) this.#attempt = 0;
    const retryInMs = backoffDelay(this.#attempt, this.#options.random);
    this.#attempt += 1;
    this.#options.onState?.({ state: "waiting", code, retryInMs });
    this.#timer = setTimeout(() => this.#connect(), retryInMs);
  }

  #endSessions(code: number): void {
    for (const session of this.#sessions.values())
      session.ended(code === CloseCode.Normal ? CloseCode.GoingAway : code);
    this.#sessions.clear();
  }

  #finish(code: number): void {
    if (this.#done) return;
    this.#done = true;
    clearTimeout(this.#timer);
    const ws = this.#socket;
    this.#socket = undefined;
    this.#endSessions(code);
    if (ws !== undefined && isOpen(ws)) ws.close(CloseCode.Normal, "host stopping");
    this.#options.onState?.({ state: "stopped", code });
    this.#stop.resolve(code);
  }
}
