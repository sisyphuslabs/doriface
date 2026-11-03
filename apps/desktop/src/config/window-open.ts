import { parseInAppLink } from "./deep-link.ts";
import { allowedExternal } from "./external.ts";
import { isSameOrigin } from "./origin.ts";

/** What a window.open, target=_blank link or modifier-click becomes: the app has exactly one window. */
export type WindowOpenRoute =
  | { readonly kind: "navigate"; readonly path: string }
  | { readonly kind: "pair"; readonly fragment: string }
  | { readonly kind: "browser"; readonly url: string }
  | { readonly kind: "none" };

/**
 * An app page becomes an in-app navigation of the one window, so nothing reloads; the web app's pairing link pairs in
 * the app, as a plain click on it does.
 */
export function routeWindowOpen(candidate: string, origin: string): WindowOpenRoute {
  if (isSameOrigin(candidate, origin)) {
    const url = new URL(candidate);
    return { kind: "navigate", path: `${url.pathname}${url.search}${url.hash}` };
  }
  const pairing = parseInAppLink(candidate);
  if (pairing?.kind === "pair") return { kind: "pair", fragment: pairing.fragment };
  const external = allowedExternal(candidate);
  return external === undefined ? { kind: "none" } : { kind: "browser", url: external };
}
