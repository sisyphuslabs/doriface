/** A loopback address that names another machine, or carries more than the path: the token is never sent there. */
export class LoopbackAddressError extends Error {
  override readonly name = "LoopbackAddressError";
}

/** `localhost`, `[::1]` or any 127.0.0.0/8 literal: the hosts a loopback gateway can be on. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * `url` if it is this computer's `/v1/hc` or `/v1/push` (whichever `kind` names) and carries nothing else; throws
 * {@link LoopbackAddressError} otherwise. Every dial that sends the loopback token goes through this first (#462).
 */
export function loopbackOnly(url: string, kind: "hc" | "push"): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  const ok =
    parsed !== undefined &&
    (parsed.protocol === "ws:" || parsed.protocol === "wss:") &&
    isLoopbackHost(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname === `/v1/${kind}`;
  if (!ok) {
    throw new LoopbackAddressError(
      `The loopback address must be on this computer: /v1/${kind} on 127.0.0.1, ::1 or localhost. The token was not sent.`,
    );
  }
  return url;
}
