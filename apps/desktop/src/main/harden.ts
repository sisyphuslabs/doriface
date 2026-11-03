import { shell, type Session, type WebContents } from "electron";
import { allowedExternal } from "../config/external.ts";
import { isSameOrigin } from "../config/origin.ts";
import { isGrantable } from "../config/permissions.ts";
import { routeWindowOpen } from "../config/window-open.ts";
import { openInAppLink, openPairingLink } from "./deep-link.ts";

/** Opens a URL that already passed the allowlist in the system browser. */
const openExternal = (url: string): void => {
  shell.openExternal(url).catch((error: unknown) => console.error(`openExternal failed: ${String(error)}`));
};

/** A pairing link stays in the app; anything else opens in the system browser when it is allowlisted. */
const openAllowed = (candidate: string): void => {
  if (openInAppLink(candidate)) return;
  const url = allowedExternal(candidate);
  if (url !== undefined) openExternal(url);
};

/**
 * Keeps every web contents on the app origin: no foreign navigation, popups, second windows or webviews. An app page
 * asked for in a new window is handed to `navigate`, which shows it in this one.
 */
export function hardenContents(contents: WebContents, origin: string, navigate: (path: string) => void): void {
  const lock = (event: { preventDefault(): void }, url: string): void => {
    if (isSameOrigin(url, origin)) return;
    event.preventDefault();
    openAllowed(url);
  };
  contents.on("will-navigate", lock);
  contents.on("will-redirect", lock);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const route = routeWindowOpen(url, origin);
    if (route.kind === "navigate") navigate(route.path);
    else if (route.kind === "pair") openPairingLink(route.fragment);
    else if (route.kind === "browser") openExternal(route.url);
    return { action: "deny" };
  });
}

/** Denies every permission except the clipboard write the app origin needs. */
export function lockPermissions(session: Session, origin: string): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isGrantable(permission, details.requestingUrl, origin));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isGrantable(permission, requestingOrigin, origin),
  );
  session.setDevicePermissionHandler(() => false);
}

/** Dev mode loads Vite over http, so the CSP rides on the response headers instead of the app: handler. */
export function applyDevCsp(session: Session, origin: string, csp: string): void {
  session.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
}
