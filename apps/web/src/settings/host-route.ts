import type { ConnectionSettings } from "../connection/settings.ts";

/** How this app reaches its host: the relay, or the plaintext loopback gateway a development build uses. */
export type HostRoute = "relay" | "loopback";

export interface HostRouteText {
  readonly route: HostRoute;
  /** The relay's host name or the loopback address, as a person reads it. */
  readonly address: string;
  /** One line under the host's name: the route, the address and whether the session is encrypted. */
  readonly label: string;
}

type RouteSettings = Pick<ConnectionSettings, "mode" | "relayUrl" | "directUrl" | "loopbackUrl">;

/** A relay or an origin as people read it: its host, without the scheme. */
const addressOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : url);

/**
 * The relay and the direct `/v1/e2ee` race both carry a Noise session, so both are end-to-end encrypted, and a paired
 * host with a known direct address may answer either way: the label names both rather than claiming one. The loopback
 * gateway is the plaintext development path the connection settings already label as such.
 */
export function hostRouteOf(settings: RouteSettings): HostRouteText {
  if (settings.mode === "loopback") {
    const address = addressOf(settings.loopbackUrl);
    return { route: "loopback", address, label: `Loopback ${address} · plain text, for development` };
  }
  const address = addressOf(settings.relayUrl);
  const direct = settings.directUrl === "" ? "" : `, or direct to ${addressOf(settings.directUrl)} when it answers`;
  return { route: "relay", address, label: `Through the relay ${address}${direct} · end-to-end encrypted` };
}
