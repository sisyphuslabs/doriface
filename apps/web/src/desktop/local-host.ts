import type { ConnectionSettings } from "../connection/settings.ts";
import type { DesktopBridge } from "./bridge.ts";

interface SettingsTarget {
  readonly settings: ConnectionSettings;
  update(settings: ConnectionSettings): void;
  start(): void;
}

/** Starts this computer's host and points the connection at it; the port and token change per launch. */
export async function useThisComputer(bridge: DesktopBridge, target: SettingsTarget): Promise<void> {
  const { url, token } = await bridge.startLocalHost();
  target.update({ ...target.settings, mode: "loopback", loopbackUrl: url, token });
}

/** On boot in the desktop app, a saved loopback connection restarts the local host instead of reusing a stale port. */
export async function bootConnection(bridge: DesktopBridge | null, target: SettingsTarget): Promise<void> {
  if (bridge === null || target.settings.mode !== "loopback") return target.start();
  try {
    await useThisComputer(bridge, target);
  } catch {
    target.start();
  }
}
