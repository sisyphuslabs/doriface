import {
  type Authorization,
  type ClientHello,
  CloseCode,
  decodePairingHello,
  type HostIdentity,
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
  /** For tests: messages per direction between rekeys. */
  readonly rekeyInterval?: number | undefined;
}

/**
 * Runs the responder handshake on a fresh `/v1/e2ee` socket. IK admits only stored devices (4401 otherwise); IKpsk2
 * claims the pending pairing code and, once the client confirmed the keys, stores the device and burns the code.
 */
export async function acceptE2ee<T>(link: WsByteLink<T>, deps: E2eeDeps): Promise<SecureLink | undefined> {
  let claim: PairingClaim | undefined;
  let deviceName = "";
  const authorize = (hello: ClientHello): Authorization => {
    if (hello.pattern === "IK") {
      return deps.devices.has(hello.remoteStatic) ? { accept: true } : { accept: false, reason: "unknown device" };
    }
    try {
      deviceName = decodePairingHello(hello.payload);
    } catch (error) {
      return { accept: false, reason: error instanceof Error ? error.message : "bad pairing hello" };
    }
    claim = deps.pairing.claim();
    return claim === undefined ? { accept: false, reason: "no pairing is pending" } : { accept: true, psk: claim.psk };
  };
  let secure: SecureLink;
  try {
    secure = await secureLink(link, {
      role: "responder",
      hostId: deps.identity.hostId,
      staticKey: deps.identity.noise,
      authorize,
      rekeyInterval: deps.rekeyInterval,
    });
  } catch (error) {
    claim?.settle(false);
    deps.log(`e2ee handshake refused: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (secure.pattern === "IKpsk2") {
    try {
      deps.devices.add(secure.remoteStatic, deviceName);
      claim?.settle(true);
    } catch (error) {
      claim?.settle(false);
      deps.log(`cannot store the paired device: ${String(error)}`);
      secure.close(1011, "cannot store the device");
      return undefined;
    }
    deps.log(`paired device "${deviceName}"`);
  }
  return secure;
}

export const REVOKED = { code: CloseCode.UnknownDevice, reason: "device revoked" } as const;
