export class HcConnectionClosedError extends Error {
  override readonly name = "HcConnectionClosedError";
}

export class HcHandshakeError extends Error {
  override readonly name = "HcHandshakeError";
}

/** A core this client cannot use, and what says so: the protocol generation it speaks, or its version under the floor. */
export type HcCoreMismatch =
  /** The core speaks a newer protocol generation than this client: the client needs an update. */
  | { readonly kind: "core-newer"; readonly generation: number }
  /** The core speaks an older protocol generation: the core needs an update to at least `need`. */
  | { readonly kind: "core-older"; readonly generation: number; readonly need: string }
  /** The core's version is under the floor: it needs an update to at least `need`. */
  | { readonly kind: "core-too-old"; readonly version: string; readonly need: string };

/** A handshake that reached a core this client cannot use; retrying cannot help, an update on one side can (#651). */
export class HcCoreMismatchError extends HcHandshakeError {
  readonly mismatch: HcCoreMismatch;

  constructor(mismatch: HcCoreMismatch) {
    super(
      mismatch.kind === "core-too-old"
        ? `core is hc ${mismatch.version}, this client needs ${mismatch.need} or newer`
        : `core speaks protocol generation ${mismatch.generation}, this client 1`,
    );
    this.mismatch = mismatch;
  }
}

export class HcProtocolError extends Error {
  override readonly name = "HcProtocolError";
}

export class HcTimeoutError extends Error {
  override readonly name = "HcTimeoutError";
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`${method} got no reply within ${timeoutMs} ms`);
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** The core's heartbeats stopped arriving on an open link: no frame came for `silentMs`, so the link is treated as gone. */
export class HcLinkSilentError extends Error {
  override readonly name = "HcLinkSilentError";
  readonly silentMs: number;

  constructor(silentMs: number) {
    super(`no heartbeat from the core for ${Math.round(silentMs / 1000)} s`);
    this.silentMs = silentMs;
  }
}
