import { HcConnection } from "@doriface/client";
import {
  closeCodeOf,
  fingerprintOf,
  type KeyPair,
  type PairingSecret,
  rawStaticKey,
  type SecureLink,
  secureLink,
  SecureLinkError,
} from "@doriface/crypto";
import { connectRelayClient, lookupPairSlot, pairSlotOf, type WebSocketLink } from "@doriface/relay-client";
import { type KnownHost, KnownHosts } from "../state/known-hosts.ts";
import type { ConnectTarget } from "./target.ts";

export interface DialOptions {
  readonly stateDir: string;
  readonly device: KeyPair;
  /** Overrides the relay a paired host was saved with, and is the relay a typed code is looked up on. */
  readonly relayUrl: string | undefined;
  readonly defaultRelayUrl: string;
  readonly deviceName: string;
  readonly log: (line: string) => void;
}

export interface Dialed {
  readonly secure: SecureLink;
  readonly link: WebSocketLink;
}

/** Pairs first when the target is a link or code (again, if this machine paired before), then opens an IK session. */
export async function dial(target: ConnectTarget, options: DialOptions): Promise<Dialed> {
  const host = await resolveHost(target, options);
  const link = await connectRelayClient({ relayUrl: options.relayUrl ?? host.relayUrl, hostId: host.hostId });
  try {
    const secure = await secureLink(link, initiator(host, options.device));
    return { secure, link };
  } catch (error) {
    throw refusal(host.hostId, error);
  }
}

const REFUSALS: Readonly<Record<number, (hostId: string) => string>> = {
  4400: (hostId) => `the handshake with host ${hostId} failed: its key does not match the one this machine paired with`,
  4401: (hostId) => `host ${hostId} does not know this machine anymore: pair it again`,
  4403: (hostId) => `the relay refused host ${hostId}'s key`,
  4404: (hostId) => `host ${hostId} is not connected to the relay: start doriface-host there`,
  4408: (hostId) => `host ${hostId} did not answer in time`,
  4410: () => "no host is pairing with this code on the relay: it may have expired",
  4429: () => "the relay is rate limiting this machine or that host: try again in a minute",
};

/** One clear line for hc to show as the reason, with the close code when there is one. */
function refusal(hostId: string, error: unknown): Error {
  const code = error instanceof Error ? closeCodeOf(error) : undefined;
  const message = code === undefined ? undefined : REFUSALS[code]?.(hostId);
  if (message === undefined) return error instanceof Error ? error : new Error(String(error));
  return new SecureLinkError(code, `${message} (${code})`, { cause: error });
}

const initiator = (host: KnownHost, device: KeyPair, pairing?: PairingSecret) =>
  ({
    role: "initiator",
    hostId: host.hostId,
    staticKey: rawStaticKey(device),
    remoteStatic: host.hostKey,
    pairing,
  }) as const;

async function resolveHost(target: ConnectTarget, options: DialOptions): Promise<KnownHost> {
  const known = new KnownHosts(options.stateDir);
  if (target.kind === "host") {
    const host = known.get(target.hostId);
    if (host !== undefined) return host;
    throw new Error(
      `this machine has not paired with host ${target.hostId}: run doriface-host connect <pairing link or code> once`,
    );
  }
  const relayUrl = options.relayUrl ?? options.defaultRelayUrl;
  if (target.kind === "link") {
    const { hostId, noiseStaticPub, linkSecret } = target.link;
    const host = { hostId, hostKey: noiseStaticPub, relayUrl: options.relayUrl ?? target.link.relayUrl };
    return pair(known, host, { mode: "link", linkSecret, name: options.deviceName }, options);
  }
  const record = await lookupPairSlot({ relayUrl, code: target.code });
  if (record === undefined) throw new Error("no host is pairing with this code on the relay: it may have expired");
  const host = { hostId: record.hostId, hostKey: record.noiseStaticPub, relayUrl };
  const pairing = { mode: "code", code: target.code, name: options.deviceName } as const;
  return pair(known, host, pairing, options, pairSlotOf(target.code));
}

/**
 * Runs the pairing session and saves the host only after it answered `hello`, which it does once it stored this
 * device, so the IK session that follows is admitted.
 */
async function pair(
  known: KnownHosts,
  host: KnownHost,
  pairing: PairingSecret,
  options: DialOptions,
  pairSlot?: string,
): Promise<KnownHost> {
  const link = await connectRelayClient({
    relayUrl: host.relayUrl,
    hostId: host.hostId,
    ...(pairSlot === undefined ? {} : { pairSlot }),
  });
  const secure = await secureLink(link, initiator(host, options.device, pairing)).catch((error: unknown) => {
    throw refusal(host.hostId, error);
  });
  (await HcConnection.open(secure)).close();
  known.add(host);
  options.log(`paired with host ${host.hostId}, fingerprint ${fingerprintOf(host.hostKey)}`);
  options.log(`from now on: doriface-host connect ${host.hostId}`);
  return host;
}
