import {
  type Authorization,
  type ByteLink,
  type ClientHello,
  CloseCode,
  type HostIdentity,
  PAIRING_CODE_ATTEMPTS,
  rawStaticKey,
  type SecureLink,
  secureLink,
  SessionKind,
} from "@doriface/crypto";
import type { DeviceStore } from "../state/devices.ts";
import type { ClaimRefusal, PairingClaim, PairingStore } from "../state/pairing.ts";

/** Where a session arrived: the direct listener, or a relay session (`openSlot` is the slot a `?pair` session named). */
export type E2eeTransport =
  | { readonly kind: "lan" }
  | { readonly kind: "relay"; readonly openSlot?: string | undefined };

export interface E2eeDeps {
  readonly identity: HostIdentity;
  readonly devices: DeviceStore;
  readonly pairing: PairingStore;
  readonly log: (line: string) => void;
  /** IP-literal LAN URLs of this host's `/v1/e2ee`, sent to clients in message 2. */
  readonly lanUrls: readonly string[];
  /** For tests: messages per direction between rekeys. */
  readonly rekeyInterval?: number | undefined;
}

const refuse = (closeCode: number, reason: string): Authorization => ({ accept: false, closeCode, reason });

/**
 * Runs the responder handshake on a fresh session (contract v1.3 "Session kinds"). A session (0x01) admits only a
 * stored device, and never on a `?pair` relay session. A typed-code pairing (0x02) runs only on a relay session
 * opened with `?pair`, and reserves one of the offer's 10 attempts before anything is answered; a link pairing (0x03)
 * runs anywhere. Once the client confirmed the keys, a pairing burns the offer and stores the device. Every refusal
 * closes before the host has answered anything.
 */
export async function acceptE2ee(
  link: ByteLink,
  deps: E2eeDeps,
  transport: E2eeTransport,
): Promise<SecureLink | undefined> {
  let claim: PairingClaim | undefined;
  let deviceName = "";
  const pairSession = transport.kind === "relay" && transport.openSlot !== undefined;
  const claimWith = (claimed: () => PairingClaim | ClaimRefusal): Authorization => {
    let result: PairingClaim | ClaimRefusal;
    try {
      result = claimed();
    } catch (error) {
      return refuse(1011, `cannot record the pairing attempt: ${String(error)}`);
    }
    if ("refused" in result) return refuse(result.refused, result.reason);
    claim = result;
    if (result.retiredCode) logRetired(deps);
    return { accept: true, secret: result.secret };
  };
  const authorize = (hello: ClientHello): Authorization => {
    deviceName = hello.name ?? "";
    if (hello.kind === SessionKind.Session) {
      if (pairSession) return refuse(CloseCode.UnknownDevice, "a ?pair session carries only pairing");
      return deps.devices.has(hello.remoteStatic)
        ? { accept: true }
        : refuse(CloseCode.UnknownDevice, "unknown device");
    }
    if (hello.kind === SessionKind.PairLink) return claimWith(() => deps.pairing.claimLink());
    if (transport.kind !== "relay" || transport.openSlot === undefined) {
      return refuse(CloseCode.UnknownDevice, "typed-code pairing runs over the relay with ?pair");
    }
    const openSlot = transport.openSlot;
    return claimWith(() => deps.pairing.claimCode(openSlot));
  };
  let secure: SecureLink;
  try {
    secure = await secureLink(link, {
      role: "responder",
      hostId: deps.identity.hostId,
      staticKey: rawStaticKey(deps.identity.noise),
      authorize,
      lanUrls: deps.lanUrls,
      rekeyInterval: deps.rekeyInterval,
    });
  } catch (error) {
    deps.log(`e2ee handshake refused: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (secure.kind !== SessionKind.Session) {
    const admitted =
      claim === undefined ? REFUSED_CLAIM : admitPairing(claim, deps.devices, secure.remoteStatic, deviceName);
    if (!admitted.ok) {
      deps.log(`pairing refused: ${admitted.reason}`);
      secure.close(admitted.code, admitted.reason);
      return undefined;
    }
    deps.log(`paired device "${deviceName}"`);
  }
  return secure;
}

function logRetired(deps: E2eeDeps): void {
  const expiresAt = deps.pairing.read()?.expiresAt;
  const until = expiresAt === undefined ? "it expires" : new Date(expiresAt).toISOString();
  deps.log(
    `pairing code retired after ${PAIRING_CODE_ATTEMPTS} failed attempts; the link still works until ${until}; run doriface-host pair for a new code`,
  );
}

export type Admission = { readonly ok: true } | { readonly ok: false; readonly code: number; readonly reason: string };

const REFUSED_CLAIM: Admission = { ok: false, code: CloseCode.UnknownDevice, reason: "no pairing claim" };

/**
 * Finishes a confirmed pairing: burns the offer first, then stores the device. A second handshake that confirmed with
 * an already used offer is refused, and a store failure leaves the offer burned rather than reusable.
 */
export function admitPairing(
  claim: PairingClaim,
  devices: DeviceStore,
  clientStatic: Uint8Array,
  name: string,
): Admission {
  if (!claim.complete())
    return { ok: false, code: CloseCode.UnknownDevice, reason: "the pairing offer was already used" };
  try {
    devices.add(clientStatic, name);
  } catch (error) {
    return { ok: false, code: 1011, reason: `cannot store the paired device: ${String(error)}` };
  }
  return { ok: true };
}

export const REVOKED = { code: CloseCode.UnknownDevice, reason: "device revoked" } as const;
