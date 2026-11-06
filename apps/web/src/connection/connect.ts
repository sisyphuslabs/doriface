import { HcConnection } from "@doriface/client";
import type { ByteLink } from "@doriface/client";
import { base64urlDecode, CloseCode, type SecureLink, secureLink, SecureLinkError } from "@doriface/crypto";
import { connectRelayClient } from "@doriface/relay-client";
import { directDial, type PageAccess, pageAccess, parseDirectAddress } from "./direct-address.ts";
import { attemptDirect, DirectFailure, type DirectReason } from "./direct-attempt.ts";
import { canForwardPlainWs, openForwardedLink } from "./direct-forward.ts";
import { BROWSER_DEPS, deviceKeyFor, type RelayDeps } from "./relay-deps.ts";
import type { ConnectionSettings } from "./settings.ts";
import { loopbackOnly } from "./loopback-address.ts";
import { openWebSocketLink } from "./ws-link.ts";

const SUBPROTOCOL = "doriface.v1";
const TOKEN_PREFIX = "doriface.token.";

/** The host no longer knows this device (revoked, or its state was reset): retrying cannot help, pairing again can. */
export class DeviceNotPairedError extends Error {
  override readonly name = "DeviceNotPairedError";
  constructor() {
    super("The host does not know this device anymore. Pair it again.");
  }
}

/** Which transport carried the session, so the workspace can say Direct or Relay (#446 §5). */
export type ConnectionPath = "direct" | "relay" | "loopback";

/** A session that opened, and the path it opened on; `directReason` says why direct did not carry it, when one is set. */
export interface OpenConnection {
  readonly connection: HcConnection;
  readonly path: ConnectionPath;
  readonly directReason?: DirectReason | undefined;
}

export interface OpenOptions {
  /** What this page may open itself; the browser's own secure context and the desktop shell's forwarder (#446 §0). */
  readonly page?: PageAccess | undefined;
  /** The direct race's budget; the contract's 300 ms unless a test needs another. */
  readonly budgetMs?: number | undefined;
  /** This attempt dials the relay at once: the one before it was a direct link that dropped (#446 §4). */
  readonly skipDirect?: boolean | undefined;
  /**
   * How long the whole attempt may take before it fails and everything it opened is closed (#653). The store grows this
   * after an attempt times out, so a slower path still gets a chance while a dead one cannot hold the UI.
   */
  readonly deadlineMs?: number | undefined;
}

/** This page's access: a secure context refuses plain `ws://` to another machine unless the shell forwards it (#449). */
const thisPage = (): PageAccess => ({ ...pageAccess(), forwardsPlainWs: canForwardPlainWs() });

/**
 * Opens a framed herdr-core connection with the given settings. In relay mode a saved direct address is tried first with
 * the same pinned Noise session; the relay carries the session when direct does not answer within the budget, or fails
 * for any reason, so a broken direct address never costs the connection (#446 §2).
 */
export async function connect(
  settings: ConnectionSettings,
  signal?: AbortSignal,
  deps: RelayDeps = BROWSER_DEPS,
  options: OpenOptions = {},
): Promise<OpenConnection> {
  const deadlineMs = options.deadlineMs;
  if (deadlineMs === undefined) return openOnPath(settings, signal, deps, options);
  return withinDeadline(settings, signal, deps, options, deadlineMs);
}

/**
 * The attempt bounded by `deadlineMs`: when it runs out, or the caller cancels, the attempt fails at once and anything
 * that arrives afterwards is closed instead of adopted (#653). Every step the attempt runs takes the controller's
 * signal, so a dial or handshake still in flight is closed rather than left to its own timeout.
 */
async function withinDeadline(
  settings: ConnectionSettings,
  signal: AbortSignal | undefined,
  deps: RelayDeps,
  options: OpenOptions,
  deadlineMs: number,
): Promise<OpenConnection> {
  const deadline = new AbortController();
  const fail = (reason: unknown): void => deadline.abort(reason instanceof Error ? reason : new Error(String(reason)));
  const timer = setTimeout(() => fail(new Error(`no session within ${deadlineMs} ms`)), deadlineMs);
  const onCaller = (): void => fail(signal?.reason);
  if (signal?.aborted === true) onCaller();
  else signal?.addEventListener("abort", onCaller, { once: true });
  const attempt = openOnPath(settings, deadline.signal, deps, options);
  try {
    return await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        const onExpire = (): void => reject(deadline.signal.reason);
        if (deadline.signal.aborted) onExpire();
        else deadline.signal.addEventListener("abort", onExpire, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCaller);
    void attempt.then(
      (opened) => {
        if (deadline.signal.aborted) opened.connection.close();
        return undefined;
      },
      () => undefined,
    );
  }
}

async function openOnPath(
  settings: ConnectionSettings,
  signal: AbortSignal | undefined,
  deps: RelayDeps,
  options: OpenOptions,
): Promise<OpenConnection> {
  if (settings.mode === "loopback") {
    const link = await openWebSocketLink(
      loopbackOnly(settings.loopbackUrl, "hc"),
      [SUBPROTOCOL, TOKEN_PREFIX + settings.token],
      signal === undefined ? {} : { signal },
    );
    return { connection: await HcConnection.open(link, signal === undefined ? {} : { signal }), path: "loopback" };
  }
  const direct = await openDirect(settings, signal, deps, options);
  if ("connection" in direct) return { connection: direct.connection, path: "direct" };
  signal?.throwIfAborted();
  const relayed = await openRelaySession(settings, deps, signal);
  const connection = await HcConnection.open(relayed, signal === undefined ? {} : { signal });
  return {
    connection,
    path: "relay",
    ...(direct.reason === undefined ? {} : { directReason: direct.reason }),
  };
}

type DirectOutcome = { readonly connection: HcConnection } | { readonly reason: DirectReason | undefined };

/**
 * One direct attempt at a saved address. Every failure is a value here: the caller dials the relay next, so an address
 * that cannot be used costs a reason, never the connection.
 */
async function openDirect(
  settings: ConnectionSettings,
  signal: AbortSignal | undefined,
  deps: RelayDeps,
  options: OpenOptions,
): Promise<DirectOutcome> {
  if (options.skipDirect === true) return { reason: undefined };
  const address = parseDirectAddress(settings.directUrl);
  if (!address.usable) return { reason: address.reason === "no address is set" ? undefined : "unusable-address" };
  const dial = directDial(address, options.page ?? thisPage());
  if (dial.kind === "blocked") return { reason: "blocked" };
  const open =
    dial.kind === "forward" ? (url: string, attempt: AbortSignal) => openForwardedLink(url, attempt) : undefined;
  try {
    const secured = await attemptDirect({
      url: dial.url,
      ...(open === undefined ? {} : { open }),
      ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
      ...(signal === undefined ? {} : { signal }),
      secure: (link) => openSessionOn(link, settings, deps),
    });
    const connection = await HcConnection.open(secured, signal === undefined ? {} : { signal });
    return { connection };
  } catch (error) {
    return { reason: directFailureReason(error) };
  }
}

function directFailureReason(error: unknown): DirectReason {
  return error instanceof DirectFailure ? error.reason : "could-not-connect";
}

async function openRelaySession(
  settings: ConnectionSettings,
  deps: RelayDeps,
  signal: AbortSignal | undefined,
): Promise<SecureLink> {
  const link = await connectRelayClient({
    relayUrl: settings.relayUrl,
    hostId: settings.hostId,
    ...(signal === undefined ? {} : { signal }),
  });
  return openSessionOn(link, settings, deps);
}

/** The session both paths run after their socket is open: Noise IK as the initiator, pinned to the paired host key. */
async function openSessionOn(link: ByteLink, settings: ConnectionSettings, deps: RelayDeps): Promise<SecureLink> {
  const staticKey = await deviceKeyFor(link, deps);
  try {
    return await secureLink(link, {
      role: "initiator",
      hostId: settings.hostId,
      staticKey,
      remoteStatic: base64urlDecode(settings.hostKey),
    });
  } catch (error) {
    if (error instanceof SecureLinkError && error.code === CloseCode.UnknownDevice) throw new DeviceNotPairedError();
    throw error;
  }
}
