import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { APP_SCHEME } from "../config/origin.ts";
import { resolveAsset } from "./assets.ts";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

/** Serves the built web app from `root` on app://, with the CSP on every response. */
export function serveApp(root: string, csp: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAsset(root, request.url);
    if (file === undefined) return new Response("not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(response.body, { status: response.status, headers });
  });
}
