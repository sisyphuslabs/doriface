import type { HcConnection } from "@doriface/client";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ApprovalOverlay } from "../approval/approval-overlay.tsx";
import { useMouseOnly, useSoftKeyboard } from "../terminal/keyboard-inset.ts";
import { useHostPlatform } from "../terminal/host-os.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import type { TerminalPort } from "../terminal/terminal-port.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { DictateButton } from "../voice/dictate-button.tsx";
import { useDictation } from "../voice/use-dictation.ts";
import { VoiceDock } from "../voice/voice-dock.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { machineOf, type Session, terminalTitle } from "./model.ts";
import { PhoneHeader } from "./phone-header.tsx";
import {
  DIRECTION_PAD_CLEARANCE,
  KEYBOARD_BUTTON_CLEARANCE,
  KEYS_BAR_HEIGHT,
  keysBottom,
  PhoneKeys,
} from "./phone-keys.tsx";
import { ConnectionLine } from "./reconnect-status.tsx";
import { afterEnd } from "./session-actions.ts";
import { useStickyKeys } from "./use-sticky-keys.ts";

export interface PhoneTerminalProps {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly terminals: readonly Session[];
  readonly onOpen: (address: string) => void;
  readonly onBack: () => void;
  /** Where this terminal registers its dictation for the shell's palette row and bound key; null while it takes none. */
  readonly dictate: RefObject<(() => void) | null>;
}

/** One session full screen on a phone, its terminal kept clear of the soft keyboard and the keys bar riding on it. */
export function PhoneTerminal({ connection, terminal, terminals, onOpen, onBack, dictate }: PhoneTerminalProps) {
  const port = useRef<TerminalPort | null>(null);
  const onPort = useCallback((next: TerminalPort | null) => {
    port.current = next;
  }, []);
  const [scope, setScope] = useState<HTMLDivElement | null>(null);
  const keyboard = useSoftKeyboard(scope);
  // A mouse-only device has no soft keyboard to ride on: its keys bar is opened and closed by hand (#287).
  const mouseOnly = useMouseOnly();
  const [keysShown, setKeysShown] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pad, setPad] = useState(false);
  // A rename moves the address, a restarted program changes the pid: either way the view attaches afresh.
  const viewKey = `${terminal.address}#${terminal.pid ?? ""}`;
  // The view that showed its program had already ended; the keys have nothing to send to under it.
  const [endedView, setEndedView] = useState<string | null>(null);
  const ended = endedView === viewKey;
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  const offline = terminal.offline === true && machine !== undefined;
  const host = useHostPlatform(connection, machine, offline);
  const sticky = useStickyKeys(port, host);
  const voice = useDictation();
  const mic = useRef<HTMLButtonElement>(null);
  const { toggle } = voice;
  // An ended view or an offline machine has nothing to type into: no mic, no dictation from the palette, and one under
  // way ends.
  useEffect(() => {
    dictate.current = offline || ended ? null : toggle;
    return () => {
      dictate.current = null;
    };
  }, [dictate, offline, ended, toggle]);
  useEffect(() => {
    if (ended || offline) voice.dictation.close();
  }, [ended, offline, voice.dictation]);
  const dictating = voice.state.kind !== "idle" && !ended && !offline;
  const keysOpen = !ended && !dictating && (keyboard.up || menu || (mouseOnly && keysShown));
  // The terminal's jump button stays clear of what floats over its bottom right: the keyboard button, or the arrow pad.
  const keysControls =
    offline || ended || dictating ? null : !keysOpen ? KEYBOARD_BUTTON_CLEARANCE : pad ? DIRECTION_PAD_CLEARANCE : null;

  return (
    // isolate: the keys float above the terminal (z-10) but stay under a dialog and its backdrop, which portal to the body.
    <div className="relative isolate flex h-dvh min-h-0 flex-col bg-card">
      <PhoneHeader
        terminal={terminal}
        terminals={terminals}
        onBack={onBack}
        onOpen={onOpen}
        action={offline || ended ? null : <DictateButton voice={voice} target={title} ref={mic} />}
      />
      <ConnectionLine />
      <div
        ref={setScope}
        className="relative flex min-h-0 flex-1 flex-col"
        style={keysOpen ? { paddingBottom: `calc(${keysBottom(keyboard.inset)} + ${KEYS_BAR_HEIGHT})` } : undefined}
      >
        {offline ? null : <ApprovalOverlay connection={connection} terminal={terminal} />}
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
            {...(keysControls === null ? {} : { jumpClearance: keysControls })}
            onEnded={() => setEndedView(viewKey)}
          />
        )}
      </div>
      {dictating ? (
        // Dictation takes the keys' place, riding on the soft keyboard when it is up; the transcript is typed past the
        // sticky modifiers, as written.
        <VoiceDock
          voice={voice}
          target={title}
          onType={(text) => {
            port.current?.send(text);
            port.current?.focus();
          }}
          onClose={() => mic.current?.focus()}
          className="pb-[max(0.5rem,var(--safe-bottom))]"
          {...(keyboard.inset > 0 ? { style: { marginBottom: `${keyboard.inset}px` } } : {})}
        />
      ) : offline || ended ? null : (
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
          pad={pad}
          onPad={setPad}
          {...(mouseOnly ? { onKeys: setKeysShown } : {})}
        />
      )}
    </div>
  );
}
