import type { ConnectionSettings } from "../connection/settings.ts";
import { type DesktopBridge, HostStartError, type HostStartFailure } from "./bridge.ts";

interface SettingsTarget {
  readonly settings: ConnectionSettings;
  update(settings: ConnectionSettings): void;
  start(): void;
  restoring(): void;
  hostStartFailed(failure: HostStartFailure): void;
}

/** Why this computer's host did not start: the shell's typed failure, or any other error as an unknown one. */
export function startFailure(cause: unknown): HostStartFailure {
  if (cause instanceof HostStartError) return cause.failure;
  const message = cause instanceof Error ? cause.message : String(cause);
  return { code: "unknown", message, details: message };
}

/** Starts this computer's host and points the connection at it; the port and token change per launch. */
export async function startThisComputer(bridge: DesktopBridge, target: SettingsTarget): Promise<void> {
  const { url, token } = await bridge.startLocalHost();
  target.update({ ...target.settings, mode: "loopback", loopbackUrl: url, token });
}

/**
 * On boot in the desktop app, a saved loopback connection restarts the local host instead of reusing
 * a stale port. It shows as connecting meanwhile, and a choice the user makes before the host answers wins.
 * A host that does not start shows why; the saved link is never tried in its place.
 */
export async function bootConnection(bridge: DesktopBridge | null, target: SettingsTarget): Promise<void> {
  if (bridge === null || target.settings.mode !== "loopback") return target.start();
  const saved = target.settings;
  target.restoring();
  try {
    const { url, token } = await bridge.startLocalHost();
    if (target.settings !== saved) return;
    target.update({ ...saved, mode: "loopback", loopbackUrl: url, token });
  } catch (cause) {
    if (target.settings === saved) target.hostStartFailed(startFailure(cause));
  }
}
