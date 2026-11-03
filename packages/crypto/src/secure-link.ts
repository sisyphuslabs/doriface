import { prologueFor, type KeyPair } from "./identity.ts";
import { type ByteLink, CloseCode, closeCodeOf, SecureLinkError } from "./link.ts";
import { Handshake, type Pattern } from "./noise/handshake.ts";
import { type SecureLink, SecuredLink } from "./secured-link.ts";
import { REKEY_INTERVAL, Transport } from "./transport.ts";

export const HANDSHAKE_TIMEOUT_MS = 10_000;
const EMPTY = new Uint8Array(0);

interface CommonOptions {
  readonly hostId: string;
  readonly staticKey: KeyPair;
  /** Closes with 4408 when the handshake has not finished in time; default {@link HANDSHAKE_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** Messages per direction between rekeys; the contract's 2^20 unless a test needs a short cycle. */
  readonly rekeyInterval?: number | undefined;
}

export interface InitiatorOptions extends CommonOptions {
  readonly role: "initiator";
  /** The host's Noise static public key. */
  readonly remoteStatic: Uint8Array;
  /** Present for the pairing session (IKpsk2); absent for every later IK session. */
  readonly psk?: Uint8Array | undefined;
  /** The message-1 payload, e.g. the pairing `{"name"}` JSON. */
  readonly payload?: Uint8Array | undefined;
}

export interface ClientHello {
  readonly pattern: Pattern;
  readonly remoteStatic: Uint8Array;
  readonly payload: Uint8Array;
}

/** IK sessions accept or refuse the client key; IKpsk2 sessions accept by naming the psk to finish with. */
export type Authorization =
  | { readonly accept: true; readonly psk?: Uint8Array | undefined }
  | { readonly accept: false; readonly reason?: string | undefined };

export interface ResponderOptions extends CommonOptions {
  readonly role: "responder";
  /** Decides on the client after message 1; a refusal closes with 4401. */
  readonly authorize: (hello: ClientHello) => Authorization;
}

export type SecureLinkOptions = InitiatorOptions | ResponderOptions;

/**
 * Runs the Noise handshake over `link` and resolves with the encrypted link. The initiator's first transport record
 * (empty) confirms the keys, so the responder resolves only once the peer provably holds them: a replayed message 1
 * never gets that far. Any failure closes `link` with its code (4400 crypto, 4401 refused, 4408 timeout) and rejects
 * with a {@link SecureLinkError}.
 */
export function secureLink(link: ByteLink, options: SecureLinkOptions): Promise<SecureLink> {
  const settled = Promise.withResolvers<SecureLink>();
  const prologue = prologueFor(options.hostId);
  const rekeyInterval = options.rekeyInterval ?? REKEY_INTERVAL;
  let session: SecuredLink | undefined;
  let pending: SecuredLink | undefined;
  let done = false;
  let onMessage: ((bytes: Uint8Array) => void) | undefined;

  const fail = (error: SecureLinkError): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (error.code !== undefined) link.close(error.code, error.message);
    settled.reject(error);
  };
  const guard = (code: number, step: () => void): void => {
    try {
      step();
    } catch (error) {
      fail(error instanceof SecureLinkError ? error : new SecureLinkError(code, "handshake failed", { cause: error }));
    }
  };
  const establish = (handshake: Handshake, helloPayload: Uint8Array): SecuredLink => {
    const { send, receive, handshakeHash, remoteStatic } = handshake.finish(rekeyInterval);
    const info = { pattern: handshake.pattern, remoteStatic, handshakeHash, helloPayload };
    return new SecuredLink(link, new Transport(send, receive), info);
  };
  const resolve = (secured: SecuredLink): void => {
    done = true;
    clearTimeout(timer);
    session = secured;
    settled.resolve(secured);
  };

  const timer = setTimeout(
    () => fail(new SecureLinkError(CloseCode.IdleTimeout, "handshake timed out")),
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );
  link.onData((bytes) => {
    if (session !== undefined) session.receive(bytes);
    else if (!done) onMessage?.(bytes);
  });
  link.onClose((error) => {
    if (session !== undefined) session.linkClosed(error);
    else fail(new SecureLinkError(closeCodeOf(error), "link closed during the handshake", { cause: error }));
  });

  if (options.role === "initiator") {
    const handshake = new Handshake({
      pattern: options.psk === undefined ? "IK" : "IKpsk2",
      role: "initiator",
      prologue,
      staticKey: options.staticKey,
      remoteStatic: options.remoteStatic,
      psk: options.psk,
    });
    onMessage = (bytes) =>
      guard(CloseCode.CryptoFailure, () => {
        handshake.readMessage(bytes);
        const secured = establish(handshake, options.payload ?? EMPTY);
        secured.send(EMPTY);
        resolve(secured);
      });
    guard(CloseCode.CryptoFailure, () => link.send(handshake.writeMessage(options.payload ?? EMPTY)));
  } else {
    onMessage = (bytes) =>
      guard(CloseCode.CryptoFailure, () => {
        const { handshake, payload } = readHello(options, prologue, bytes);
        const verdict = options.authorize({
          pattern: handshake.pattern,
          remoteStatic: requireStatic(handshake),
          payload,
        });
        if (!verdict.accept) throw new SecureLinkError(CloseCode.UnknownDevice, verdict.reason ?? "unknown device");
        if (handshake.pattern === "IKpsk2") {
          if (verdict.psk === undefined) throw new SecureLinkError(CloseCode.UnknownDevice, "no pairing is pending");
          handshake.setPsk(verdict.psk);
        }
        link.send(handshake.writeMessage(EMPTY));
        pending = establish(handshake, payload);
        onMessage = (record) => confirm(record);
      });
    const confirm = (record: Uint8Array): void =>
      guard(CloseCode.CryptoFailure, () => {
        const secured = pending;
        if (secured === undefined) return;
        secured.receive(record);
        if (secured.closed) throw new SecureLinkError(CloseCode.CryptoFailure, "key confirmation failed");
        resolve(secured);
      });
  }
  return settled.promise;
}

/** Message 1 tells IK from IKpsk2 only by which protocol name decrypts it, so try IK first, then IKpsk2. */
function readHello(
  options: ResponderOptions,
  prologue: Uint8Array,
  message: Uint8Array,
): { readonly handshake: Handshake; readonly payload: Uint8Array } {
  let lastError: unknown;
  for (const pattern of ["IK", "IKpsk2"] as const) {
    const handshake = new Handshake({ pattern, role: "responder", prologue, staticKey: options.staticKey });
    try {
      return { handshake, payload: handshake.readMessage(message) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new SecureLinkError(CloseCode.CryptoFailure, "message 1 failed authentication", { cause: lastError });
}

function requireStatic(handshake: Handshake): Uint8Array {
  const remoteStatic = handshake.remoteStatic;
  if (remoteStatic === undefined) throw new SecureLinkError(CloseCode.CryptoFailure, "message 1 carried no static key");
  return remoteStatic;
}
