import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** CI points this at the electron-builder --dir output so the packaged app is what launches. */
export const packagedExecutable = process.env["DORIFACE_E2E_EXECUTABLE"];

const hideWindows = join(appDir, "e2e", "hide-windows.cjs");

/**
 * The command-line arguments that start the app from this checkout with every window hidden (Electron's -r loads the
 * hook before the app), followed by `extra`. A packaged executable cannot load it and takes `extra` alone.
 */
export function appArgs(extra: readonly string[] = []): string[] {
  return packagedExecutable === undefined ? ["-r", hideWindows, appDir, ...extra] : [...extra];
}
