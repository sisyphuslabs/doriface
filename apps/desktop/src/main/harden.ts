import { shell, type Session, type WebContents } from "electron";
import { allowedExternal } from "../config/external.ts";
import { isSameOrigin } from "../config/origin.ts";
import { isGrantable } from "../config/permissions.ts";
import { routeWindowOpen } from "../config/window-open.ts";

const openAllowed = (candidate: string): void => {
  const url = allowedExternal(candidate);
  if (url === undefined) return;
  shell.openExternal(url).catch((error: unknown) => console.error(`openExternal failed: ${String(error)}`));
};

/** Keeps every web contents on the app origin: no foreign navigation, popups, second windows or webviews. */
export function hardenContents(contents: WebContents, origin: string): void {
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
    if (route.kind === "same-window") {
      contents
        .loadURL(route.url)
        .catch((error: unknown) => console.error(`could not open ${route.url}: ${String(error)}`));
    } else if (route.kind === "browser") {
      openAllowed(route.url);
    }
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
