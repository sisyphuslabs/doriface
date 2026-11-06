import { isLoopbackHost } from "./loopback-address.ts";

/**
 * The "Direct address" setting, read the one way the client may use it: an address that names only a host's
 * `/v1/e2ee` listener. A saved value is checked exactly like a new one, and an unusable one is never dialed (#446).
 */
export type DirectAddress =
  | { readonly usable: true; readonly url: string; readonly loopback: boolean }
  | { readonly usable: false; readonly reason: string };

const E2EE_PATH = "/v1/e2ee";
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * `host:port` is read as `ws://host:port`; `ws://` and `wss://` are the only schemes, and the path may be absent or
 * exactly `/v1/e2ee`. Credentials, a query and a fragment are refused: nothing but the host's session route is dialed.
 */
export function parseDirectAddress(value: string): DirectAddress {
  const trimmed = value.trim();
  if (trimmed === "") return { usable: false, reason: "no address is set" };
  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `ws://${trimmed}`);
  } catch {
    return { usable: false, reason: "this is not an address" };
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    return { usable: false, reason: "only ws:// and wss:// are accepted" };
  if (url.hostname === "") return { usable: false, reason: "the address names no machine" };
  if (url.username !== "" || url.password !== "") return { usable: false, reason: "an address carries no credentials" };
  if (url.search !== "" || url.hash !== "")
    return { usable: false, reason: "an address carries no query and no fragment" };
  if (url.pathname !== "/" && url.pathname !== E2EE_PATH)
    return { usable: false, reason: `the only path is ${E2EE_PATH}` };
  return { usable: true, url: `${url.protocol}//${url.host}${E2EE_PATH}`, loopback: isLoopbackHost(url.hostname) };
}

/** How a usable address is reached from this page: dialed here, forwarded by the desktop shell, or not at all. */
export type DirectDial =
  | { readonly kind: "dial"; readonly url: string }
  | { readonly kind: "forward"; readonly url: string }
  | { readonly kind: "blocked"; readonly reason: string };

/** What this page may open itself. A secure context blocks plain `ws://` to another machine as mixed content. */
export interface PageAccess {
  /** The page runs in a secure context: https, or the desktop app's `app://` origin. */
  readonly secureContext: boolean;
  /** The desktop shell forwards plain `ws://` bytes for this page, so the page never opens that socket (#449). */
  readonly forwardsPlainWs: boolean;
}

/** This page's own access, as the browser reports it: nothing forwards a plain `ws://` here on its own. */
export function pageAccess(scope: { readonly isSecureContext?: boolean | undefined } = globalThis): PageAccess {
  return { secureContext: scope.isSecureContext === true, forwardsPlainWs: false };
}

const MIXED_CONTENT = "this page can't open ws:// to another machine; use wss://";

/**
 * `wss://` is dialed by the page, and so is loopback `ws://`, which no secure context blocks. A plain `ws://` to another
 * machine is dialed only where the page may open it (a dev build's http origin) or through the desktop shell (#446 §0).
 */
export function directDial(address: Extract<DirectAddress, { readonly usable: true }>, page: PageAccess): DirectDial {
  if (address.url.startsWith("wss://") || address.loopback) return { kind: "dial", url: address.url };
  if (page.forwardsPlainWs) return { kind: "forward", url: address.url };
  if (!page.secureContext) return { kind: "dial", url: address.url };
  return { kind: "blocked", reason: MIXED_CONTENT };
}
