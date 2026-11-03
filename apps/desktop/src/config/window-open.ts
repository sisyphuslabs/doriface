import { allowedExternal } from "./external.ts";
import { isSameOrigin } from "./origin.ts";

/** What a window.open, target=_blank link or modifier-click becomes: the app has exactly one window. */
export type WindowOpenRoute =
  | { readonly kind: "same-window"; readonly url: string }
  | { readonly kind: "browser"; readonly url: string }
  | { readonly kind: "none" };

export function routeWindowOpen(candidate: string, origin: string): WindowOpenRoute {
  if (isSameOrigin(candidate, origin)) return { kind: "same-window", url: candidate };
  const external = allowedExternal(candidate);
  return external === undefined ? { kind: "none" } : { kind: "browser", url: external };
}
