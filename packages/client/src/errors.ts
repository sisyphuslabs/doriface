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
