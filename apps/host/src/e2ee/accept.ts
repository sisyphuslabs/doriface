import {
  type Authorization,
  type ClientHello,
  CloseCode,
  type HostIdentity,
  rawStaticKey,
  type SecureLink,
  secureLink,
} from "@doriface/crypto";
import type { DeviceStore } from "../state/devices.ts";
import type { PairingClaim, PairingStore } from "../state/pairing.ts";
import type { WsByteLink } from "./links.ts";

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

/**
 * Runs the responder handshake on a fresh `/v1/e2ee` socket. IK admits only stored devices (4401 otherwise); IKpsk2
 * claims the pending pairing code and, once the client confirmed the keys, burns the code and stores the device. A
 * failed attempt leaves the code open: codes end only on success or expiry, and the relay bounds guesses per slot.
 */
export async function acceptE2ee<T>(link: WsByteLink<T>, deps: E2eeDeps): Promise<SecureLink | undefined> {
  let claim: PairingClaim | undefined;
  let deviceName = "";
  const authorize = (hello: ClientHello): Authorization => {
    if (hello.pattern === "IK") {
      return deps.devices.has(hello.remoteStatic) ? { accept: true } : { accept: false, reason: "unknown device" };
    }
    deviceName = hello.name ?? "";
    claim = deps.pairing.claim();
    return claim === undefined ? { accept: false, reason: "no pairing is pending" } : { accept: true, psk: claim.psk };
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
  if (secure.pattern === "IKpsk2") {
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

export type Admission = { readonly ok: true } | { readonly ok: false; readonly code: number; readonly reason: string };

const REFUSED_CLAIM: Admission = { ok: false, code: CloseCode.UnknownDevice, reason: "no pairing claim" };

/**
 * Finishes a confirmed IKpsk2 pairing: burns the code first, then stores the device. A second handshake that confirmed
 * with an already used code is refused, and a store failure leaves the code burned rather than reusable.
 */
export function admitPairing(
  claim: PairingClaim,
  devices: DeviceStore,
  clientStatic: Uint8Array,
  name: string,
): Admission {
  if (!claim.complete())
    return { ok: false, code: CloseCode.UnknownDevice, reason: "the pairing code was already used" };
  try {
    devices.add(clientStatic, name);
  } catch (error) {
    return { ok: false, code: 1011, reason: `cannot store the paired device: ${String(error)}` };
  }
  return { ok: true };
}

export const REVOKED = { code: CloseCode.UnknownDevice, reason: "device revoked" } as const;
