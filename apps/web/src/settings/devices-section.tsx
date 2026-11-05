import { SettingRow } from "@doriface/ui";
import { Monitor, Server } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import type { ConnectionSettings } from "../connection/settings.ts";
import { connectionStore, useConnection, type ConnectionState } from "../connection/store.ts";

function useConnectionSettings(): ConnectionSettings {
  return useSyncExternalStore(connectionStore.subscribe, () => connectionStore.settings);
}

function describe(state: ConnectionState): string {
  switch (state.phase) {
    case "open":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "failed":
      return state.error.message;
    case "host-failed":
      return state.failure.message;
    case "unconfigured":
      return "Not paired yet";
  }
}

function label(icon: ReactNode, text: string) {
  return (
    <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </span>
  );
}

/** This device and the host it is set up for. Revoking other devices needs the encrypted session. */
export function DevicesSection() {
  const state = useConnection();
  const settings = useConnectionSettings();
  const host =
    state.phase === "open"
      ? state.connection.hello.core.name
      : settings.mode === "relay"
        ? settings.hostId || "No host"
        : settings.loopbackUrl;
  return (
    <>
      <SettingRow title={label(<Monitor aria-hidden />, "This browser")} description="This device" control={null} />
      <SettingRow title={label(<Server aria-hidden />, host)} description={describe(state)} control={null} />
    </>
  );
}
