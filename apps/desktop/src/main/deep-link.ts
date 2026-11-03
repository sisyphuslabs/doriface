import { parseDeepLink, parseInAppLink, type DeepLink } from "../config/deep-link.ts";
import { Channel } from "../shared/bridge.ts";

export interface DeepLinkRenderer {
  send(channel: typeof Channel.pairingLinkWaiting): void;
}

let reveal: () => DeepLinkRenderer | undefined = () => undefined;
let pending: string | undefined;

/**
 * `show` brings the one window forward (creating it when the app has none) and returns its renderer, or undefined
 * before the app is ready; the window made at startup then takes the waiting link when it loads.
 */
export function routeDeepLinksTo(show: () => DeepLinkRenderer | undefined): void {
  reveal = show;
}

/**
 * The secret stays in the main process until the window's renderer asks for it over the gated IPC channel: the
 * renderer is only told that a link waits, and the link never becomes a URL that history could keep.
 */
function open(link: DeepLink): void {
  if (link.kind === "pair") pending = link.fragment;
  const renderer = reveal();
  if (link.kind === "pair") renderer?.send(Channel.pairingLinkWaiting);
}

/** A `doriface:` link from the OS: open-url on macOS, a launch's argv on Windows and Linux. */
export function openDeepLink(candidate: string): void {
  const link = parseDeepLink(candidate);
  // The link itself is never logged: it may carry a pairing secret.
  if (link === undefined) console.error("refused a doriface: link that is not on the allowlist");
  else open(link);
}

/** A link clicked inside the app; true when it was a pairing link and stays in the app. */
export function openInAppLink(candidate: string): boolean {
  const link = parseInAppLink(candidate);
  if (link === undefined) return false;
  open(link);
  return true;
}

export function takePairingLink(): string | undefined {
  const link = pending;
  pending = undefined;
  return link;
}
