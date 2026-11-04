export class HcConnectionClosedError extends Error {
  override readonly name = "HcConnectionClosedError";
}

export class HcHandshakeError extends Error {
  override readonly name = "HcHandshakeError";
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
