import { Button, SettingRow } from "@doriface/ui";
import { Monitor, Server, Smartphone } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ConnectionSettings } from "../connection/settings.ts";
import { hostFailure } from "../connection/host-failure.ts";
import { connectionStore, useConnection, type ConnectionState } from "../connection/store.ts";
import { desktopPairOffer } from "../desktop/pair-bridge.ts";
import { PairDeviceDialog } from "./pair-device-dialog.tsx";

function useConnectionSettings(): ConnectionSettings {
  return useSyncExternalStore(connectionStore.subscribe, () => connectionStore.settings);
}

function describe(state: ConnectionState): ReactNode {
  switch (state.phase) {
    case "open":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "failed":
      return (
        <>
          {hostFailure(state.error)}
          {/* The transport's own words (a close code) only behind a disclosure, for a report (#477). */}
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer">Details</summary>
            <span className="[overflow-wrap:anywhere]">{state.error.message}</span>
          </details>
        </>
      );
    case "host-failed":
      return state.failure.message;
    case "unconfigured":
      return "Not paired yet";
  }
}

function label(icon: ReactNode, text: string) {
  return (
    <span className="flex items-start gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {/* One line tall, so the icon centres on the text's first line however many lines the text takes. */}
      <span className="flex h-[1lh] shrink-0 items-center">{icon}</span>
      <span className="min-w-0">{text}</span>
    </span>
  );
}

/**
 * This device, the host it is set up for, and — on this computer's own host — the offer that pairs a new device to it.
 * Revoking other devices needs the encrypted session.
 */
export function DevicesSection() {
  const state = useConnection();
  const settings = useConnectionSettings();
  const [pairing, setPairing] = useState(false);
  // One relay function for this page: a new one each render would reopen the offer the dialog is showing.
  const pair = useMemo(() => desktopPairOffer(), []);
  // The host names itself as it answers; that name is kept beside the paired host, so the row still names it once the
  // link drops or the page is loaded again while it is down (#496). The id is only left when no name was ever learned.
  const name = state.phase === "open" ? state.connection.hello.core.name : settings.hostName;
  const host = name !== "" ? name : settings.mode === "relay" ? settings.hostId || "No host" : settings.loopbackUrl;
  // Only this computer's own host can be offered to a device: the shell relays its offer, and a host this app merely
  // reaches over the relay runs somewhere else.
  const offersItself = pair !== null && settings.mode === "loopback";
  return (
    <>
      <SettingRow title={label(<Monitor aria-hidden />, "This browser")} description="This device" control={null} />
      <SettingRow title={label(<Server aria-hidden />, host)} description={describe(state)} control={null} />
      {offersItself ? (
        <SettingRow
          title={label(<Smartphone aria-hidden />, "Pair a device")}
          description="A phone or another computer that pairs with this computer can open its terminals, end to end encrypted."
          control={
            <Button size="sm" onClick={() => setPairing(true)}>
              Pair a device
            </Button>
          }
        />
      ) : null}
      <PairDeviceDialog open={pairing} onClose={() => setPairing(false)} pair={pair} />
    </>
  );
}
