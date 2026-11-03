import { prologueFor } from "./identity.ts";
import { type ByteLink, CloseCode, closeCodeOf, SecureLinkError } from "./link.ts";
import { Handshake, type Pattern } from "./noise/handshake.ts";
import { type SecureLink, SecuredLink } from "./secured-link.ts";
import type { StaticKey } from "./static-key.ts";
import { REKEY_INTERVAL, Transport } from "./transport.ts";

export const HANDSHAKE_TIMEOUT_MS = 10_000;
const EMPTY = new Uint8Array(0);

interface CommonOptions {
  readonly hostId: string;
  /** The local static key (raw bytes for the host, possibly a non-extractable WebCrypto key on the web). */
  readonly staticKey: StaticKey;
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

const failure = (code: number, message: string, cause?: unknown): SecureLinkError =>
  new SecureLinkError(code, message, cause === undefined ? undefined : { cause });

/**
 * Runs the Noise handshake over `link` and resolves with the encrypted link. Messages are processed strictly in order
 * even though the static DH is async. The initiator's first transport record (empty) confirms the keys, so the
 * responder resolves only once the peer provably holds them: a replayed message 1
 * never gets that far. Any failure closes `link` with its code (4400 crypto, 4401 refused, 4408 timeout) and rejects
 * with a {@link SecureLinkError}.
 */
export function secureLink(link: ByteLink, options: SecureLinkOptions): Promise<SecureLink> {
  const settled = Promise.withResolvers<SecureLink>();
  const prologue = prologueFor(options.hostId);
  const rekeyInterval = options.rekeyInterval ?? REKEY_INTERVAL;
  const inbox: Uint8Array[] = [];
  let session: SecuredLink | undefined;
  let done = false;
  let draining = false;
  let step: ((bytes: Uint8Array) => Promise<void>) | undefined;

  const fail = (error: SecureLinkError): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    inbox.length = 0;
    if (error.code !== undefined) link.close(error.code, error.message);
    settled.reject(error);
  };
  const guarded = (fn: (bytes: Uint8Array) => Promise<void>) => async (bytes: Uint8Array) => {
    try {
      await fn(bytes);
    } catch (error) {
      if (error instanceof SecureLinkError) fail(error);
      else fail(failure(CloseCode.CryptoFailure, "handshake failed", error));
    }
  };
  const establish = (handshake: Handshake, helloPayload: Uint8Array): SecuredLink => {
    const { send, receive, handshakeHash, remoteStatic } = handshake.finish(rekeyInterval);
    const info = { pattern: handshake.pattern, remoteStatic, handshakeHash, helloPayload };
    return new SecuredLink(link, new Transport(send, receive), info);
  };
  /** Installs the session before anything else is sent, so a peer that answers synchronously reaches it. */
  const resolve = (secured: SecuredLink): void => {
    done = true;
    clearTimeout(timer);
    session = secured;
    for (const bytes of inbox.splice(0)) secured.receive(bytes);
    settled.resolve(secured);
  };
  const drain = async (): Promise<void> => {
    const bytes = inbox.shift();
    if (bytes === undefined || done || step === undefined) {
      draining = false;
      return;
    }
    await step(bytes);
    return drain();
  };

  const timer = setTimeout(
    () => fail(failure(CloseCode.IdleTimeout, "handshake timed out")),
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );
  link.onData((bytes) => {
    if (session !== undefined) return session.receive(bytes);
    if (done) return;
    inbox.push(bytes);
    if (draining) return;
    draining = true;
    void drain();
  });
  link.onClose((error) => {
    if (session !== undefined) session.linkClosed(error);
    else fail(failure(closeCodeOf(error) ?? CloseCode.CryptoFailure, "link closed during the handshake", error));
  });

  if (options.role === "initiator") runInitiator(options);
  else runResponder(options);
  return settled.promise;

  function runInitiator(opts: InitiatorOptions): void {
    const handshake = new Handshake({
      pattern: opts.psk === undefined ? "IK" : "IKpsk2",
      role: "initiator",
      prologue,
      staticKey: opts.staticKey,
      remoteStatic: opts.remoteStatic,
      psk: opts.psk,
    });
    step = guarded(async (bytes) => {
      await handshake.readMessage(bytes);
      const secured = establish(handshake, opts.payload ?? EMPTY);
      resolve(secured);
      secured.send(EMPTY);
    });
    void guarded(async () => link.send(await handshake.writeMessage(opts.payload ?? EMPTY)))(EMPTY);
  }

  function runResponder(opts: ResponderOptions): void {
    let pending: SecuredLink | undefined;
    const confirm = guarded(async (record) => {
      const secured = pending;
      if (secured === undefined) return;
      secured.receive(record);
      if (secured.closed) throw failure(CloseCode.CryptoFailure, "key confirmation failed");
      resolve(secured);
    });
    step = guarded(async (bytes) => {
      const { handshake, payload } = await readHello(opts, prologue, bytes);
      const remoteStatic = handshake.remoteStatic;
      if (remoteStatic === undefined) throw failure(CloseCode.CryptoFailure, "message 1 carried no static key");
      const verdict = opts.authorize({ pattern: handshake.pattern, remoteStatic, payload });
      if (!verdict.accept) throw failure(CloseCode.UnknownDevice, verdict.reason ?? "unknown device");
      if (handshake.pattern === "IKpsk2") {
        if (verdict.psk === undefined) throw failure(CloseCode.UnknownDevice, "no pairing is pending");
        handshake.setPsk(verdict.psk);
      }
      const reply = await handshake.writeMessage(EMPTY);
      pending = establish(handshake, payload);
      step = confirm;
      link.send(reply);
    });
  }
}

/** Message 1 tells IK from IKpsk2 only by which protocol name decrypts it, so try IK first, then IKpsk2. */
async function readHello(
  options: ResponderOptions,
  prologue: Uint8Array,
  message: Uint8Array,
): Promise<{ readonly handshake: Handshake; readonly payload: Uint8Array }> {
  const attempt = async (pattern: Pattern) => {
    const handshake = new Handshake({ pattern, role: "responder", prologue, staticKey: options.staticKey });
    return { handshake, payload: await handshake.readMessage(message) };
  };
  try {
    return await attempt("IK");
  } catch {
    try {
      return await attempt("IKpsk2");
    } catch (error) {
      throw failure(CloseCode.CryptoFailure, "message 1 failed authentication", error);
    }
  }
}
