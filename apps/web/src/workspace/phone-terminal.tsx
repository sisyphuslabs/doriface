import type { HcConnection } from "@doriface/client";
import { useCallback, useRef, useState } from "react";
import { useSoftKeyboard } from "../terminal/keyboard-inset.ts";
import { hostPlatform } from "../terminal/keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import type { TerminalPort } from "../terminal/terminal-port.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { machineOf, type Session, terminalTitle } from "./model.ts";
import { PhoneHeader } from "./phone-header.tsx";
import { PaneSwitcher } from "./phone-pane-switcher.tsx";
import { KEYS_BAR_HEIGHT, keysBottom, PhoneKeys } from "./phone-keys.tsx";
import { ConnectionLine } from "./reconnect-status.tsx";
import { afterEnd } from "./session-actions.ts";
import { useStickyKeys } from "./use-sticky-keys.ts";

export interface PhoneTerminalProps {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly terminals: readonly Session[];
  /** The terminals of the tab that shows this one, in its panes' order; one when that tab is not split. */
  readonly panes: readonly string[];
  readonly onOpen: (address: string) => void;
  readonly onBack: () => void;
}

/** One session full screen on a phone, its terminal kept clear of the soft keyboard and the keys bar riding on it. */
export function PhoneTerminal({ connection, terminal, terminals, panes, onOpen, onBack }: PhoneTerminalProps) {
  const port = useRef<TerminalPort | null>(null);
  const onPort = useCallback((next: TerminalPort | null) => {
    port.current = next;
  }, []);
  const [scope, setScope] = useState<HTMLDivElement | null>(null);
  const keyboard = useSoftKeyboard(scope);
  const [menu, setMenu] = useState(false);
  // A rename moves the address, a restarted program changes the pid: either way the view attaches afresh.
  const viewKey = `${terminal.address}#${terminal.pid ?? ""}`;
  // The view that showed its program had already ended; the keys have nothing to send to under it.
  const [endedView, setEndedView] = useState<string | null>(null);
  const ended = endedView === viewKey;
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  const host = hostPlatform(machine ?? connection.hello.core.name);
  const sticky = useStickyKeys(port, host);
  const offline = terminal.offline === true && machine !== undefined;
  const keysOpen = !ended && (keyboard.up || menu);

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-card">
      <PhoneHeader terminal={terminal} terminals={terminals} onBack={onBack} onOpen={onOpen} />
      <ConnectionLine />
      <PaneSwitcher panes={panes} open={terminal.address} onOpen={onOpen} />
      <div
        ref={setScope}
        className="flex min-h-0 flex-1 flex-col"
        style={keysOpen ? { paddingBottom: `calc(${keysBottom(keyboard.inset)} + ${KEYS_BAR_HEIGHT})` } : undefined}
      >
        {offline ? (
          <MachineOffline machine={machine} />
        ) : (
          <TerminalView
            key={viewKey}
            connection={connection}
            address={terminal.address}
            pid={terminal.pid ?? null}
            live={terminal.state === "live"}
            focused
            label={`${title} output`}
            transformInput={sticky.transform}
            onPort={onPort}
            // An End of this session leaves the screen only once it has removed the terminal (see afterEnd).
            onEnd={(address, end) => (closesTab(end) ? afterEnd(address, onBack) : undefined)}
            // The header already has Back to agents; this one closes the ended session.
            closeLabel="Close"
            onEnded={() => setEndedView(viewKey)}
          />
        )}
      </div>
      {offline || ended ? null : (
        <PhoneKeys
          port={port}
          open={keysOpen}
          inset={keyboard.inset}
          host={host}
          sticky={sticky}
          terminals={terminals}
          current={terminal.address}
          onOpen={onOpen}
          onMenu={setMenu}
        />
      )}
    </div>
  );
}
