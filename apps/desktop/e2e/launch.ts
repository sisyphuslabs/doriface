import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** CI points this at the electron-builder --dir output so the packaged app is what launches. */
export const packagedExecutable = process.env["DORIFACE_E2E_EXECUTABLE"];

const hideWindows = join(appDir, "e2e", "hide-windows.cjs");

/**
 * Linux e2e runs draw on xvfb, which has no GPU. Without --disable-gpu the GPU process first brings up Mesa's GL
 * (ANGLE over GLX, loading libLLVM and libgallium) only to end up compositing in software anyway, and the window is not
 * shown until that is done. On a cold CI runner that took from seconds to over 30 s, and no frame of a window that is
 * not shown can be captured (#80).
 */
const platformArgs: readonly string[] = process.platform === "linux" ? ["--disable-gpu"] : [];

/**
 * The command-line arguments every e2e launch passes, followed by `extra`: from this checkout they start the app with
 * every window hidden (Electron's -r loads the hook before the app); a packaged executable cannot load the hook.
 */
export function appArgs(extra: readonly string[] = []): string[] {
  const args = [...platformArgs, ...extra];
  return packagedExecutable === undefined ? ["-r", hideWindows, appDir, ...args] : args;
}
