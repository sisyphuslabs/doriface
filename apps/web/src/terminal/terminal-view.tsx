import type { HcConnection, TerminalStream } from "@doriface/client";
import { cn, useToastManager } from "@doriface/ui";
import { loadGhosttyCore } from "@doriface/ghostty-wasm";
import type { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle, type WTerm } from "@wterm/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { terminalConfigStore, useTerminalConfig } from "../ghostty/config-store.ts";
import { rendererOptions } from "../ghostty/render-options.ts";
import { readDisplay } from "./display.ts";
import { PasteDialog } from "./paste-dialog.tsx";
import { CursorResets } from "./cursor-reset.ts";
import { readThemeColors } from "./theme-colors.ts";
import { useBehaviors, type PendingPaste } from "./use-behaviors.ts";
import { useFocusAfterSelect } from "./use-focus-after-select.ts";
import { type TerminalEnd, terminalEnd } from "./terminal-end.ts";
import { useTerminalActions } from "./use-terminal-actions.ts";

/** Typed text, or the bytes a bound key sends. */
export type TerminalInput = string | Uint8Array;

export interface TerminalViewProps {
  readonly connection: HcConnection;
  readonly address: string;
  /** The program this view was opened for; views are keyed by it, so a restarted program gets a new view. */
  readonly pid: number | null;
  readonly focused: boolean;
  readonly label: string;
  readonly className?: string;
  /** Rewrites typed input before it is sent (latched phone modifiers). */
  readonly transformInput?: (data: string) => string;
  /** The view's input path for keys pressed outside it (the phone's extra keys); null once it unmounts. */
  readonly onSend?: (send: ((data: TerminalInput) => void) | null) => void;
  /** Every time the stream ends, with why; see TerminalEnd. */
  readonly onEnd?: (address: string, end: TerminalEnd) => void;
}

const HISTORY_LINES = 2_000;
/** RIS: clears the screen and scrollback before an attach replay draws them again. */
const FULL_RESET = "\u001bc";

/** One libghostty terminal attached to one hc channel; output credit returns once it is written. */
export function TerminalView(props: TerminalViewProps) {
  const { connection, address, pid, focused, label, className, transformInput, onSend, onEnd } = props;
  const config = useTerminalConfig();
  const options = useMemo(() => rendererOptions(config), [config]);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [wt, setWt] = useState<WTerm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toasts = useToastManager();
  const [paste, setPaste] = useState<PendingPaste | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const stream = useRef<TerminalStream | null>(null);

  useEffect(() => {
    let live = true;
    // scrollback-limit applies to new terminals, so the core reads it once, after the stored config loads.
    terminalConfigStore.loaded
      .then(() => loadGhosttyCore({ scrollbackLimit: rendererOptions(terminalConfigStore.config).scrollbackBytes }))
      .then(
        (loaded) => (live ? setCore(loaded) : loaded.dispose()),
        (cause: unknown) => setError(`The terminal renderer failed to load: ${String(cause)}`),
      );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => void stream.current?.close(), []);

  useEffect(() => {
    if (focused) handle.current?.focus();
  }, [focused]);

  // The default cursor shape is the terminal's own state, set locally; programs still override it.
  useEffect(() => handle.current?.write(options.cursorSequence), [wt, options.cursorSequence]);

  // After the stylesheet changes, tell libghostty and the core the colors programs may query.
  useEffect(() => {
    if (wt === null) return undefined;
    const frame = requestAnimationFrame(() => {
      const colors = readThemeColors(wt.element);
      if (colors !== null) wt.setThemeColors(colors);
      stream.current?.facts(readDisplay(wt.element));
      wt.fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [wt, config]);

  const onUnsafePaste = useCallback((pending: PendingPaste) => setPaste(pending), []);
  // Input while no stream is open (attaching, or the connection dropped) waits here for the next stream.
  // Every human-input write goes through send, so keys pressed during a reconnect replay in the order pressed.
  const pending = useRef<TerminalInput[]>([]);
  const send = useCallback((data: TerminalInput): void => {
    if (stream.current?.write(data) !== true) pending.current.push(data);
  }, []);
  useEffect(() => {
    onSend?.(send);
    return () => onSend?.(null);
  }, [onSend, send]);
  useBehaviors(wt, stream, options, onUnsafePaste);
  useTerminalActions(wt, send, focused);
  useFocusAfterSelect(wt);
  const attachedTo = useRef(connection);
  const attachedBefore = useRef(false);
  const program = useRef(pid);
  const isFocused = useRef(focused);
  useEffect(() => {
    isFocused.current = focused;
  }, [focused]);

  const attach = (ready: WTerm): void => {
    setWt(ready);
    attachedTo.current = connection;
    // wterm starts every grid at 80x24 and fits it later; the pty starts at the size the view renders.
    ready.fit();
    const { cols, rows } = ready;
    const display = readDisplay(ready.element);
    // A reattach after a reconnect says so: the core applies its size only once this viewer is active again.
    const resumed = attachedBefore.current ? { resumed: true } : {};
    connection
      .attach({ terminal: address, cols, rows, history: HISTORY_LINES, display, ...resumed }, { autoCredit: false })
      .then(
        (attached) => {
          // The program restarted while the line was down: what was typed for it must not reach the new one.
          if (attachedBefore.current && attached.terminal.pid !== program.current) {
            void attached.close();
            if (pending.current.splice(0).length > 0) {
              toasts.add({ type: "warning", title: "Typed input was not sent because the program restarted" });
            }
            return undefined;
          }
          stream.current = attached;
          // The view in use was the active viewer before the drop; a FOCUS frame makes it active again, so the core
          // applies its size now. Unfocused views stay deferred until they are focused (onFocus), as resumed intends.
          if (attachedBefore.current && isFocused.current) attached.focus(true);
          // A fit while the attach was in flight had no stream to resize.
          if (ready.cols !== cols || ready.rows !== rows) attached.resize(ready.cols, ready.rows);
          // Reattached after a reconnect: the replay redraws everything, so the old screen and scrollback go first.
          if (attachedBefore.current) handle.current?.write(FULL_RESET);
          attachedBefore.current = true;
          const resets = new CursorResets();
          attached.onData((bytes) => {
            handle.current?.write(bytes);
            attached.consumed(bytes.byteLength);
            // A cursor reset (the attach replay starts with one) means the default shape: the configured cursor-style.
            if (resets.push(bytes)) handle.current?.write(rendererOptions(terminalConfigStore.config).cursorSequence);
          });
          attached.onClose((close) => {
            if (stream.current === attached) stream.current = null;
            onEnd?.(address, terminalEnd(close));
          });
          for (const data of pending.current.splice(0)) attached.write(data);
          // An open overlay takes focus straight back (useOverlayFocus), so the terminal can always ask for it.
          if (isFocused.current) ready.focus();
          return attached;
        },
        (cause: unknown) => {
          // The connection dropped mid-attach: the next one attaches again (below).
          if (connection.closed) return;
          const message = `Could not open ${address}: ${String(cause)}`;
          if (!attachedBefore.current) return setError(message);
          // A program that ended while the connection was down sent no CLOSE; its tab closes as that CLOSE would have.
          void connection.call("terminal.get", { terminal: address }).then(
            (terminal) => (terminal.state === "live" ? setError(message) : onEnd?.(address, "finished")),
            () => (connection.closed ? undefined : onEnd?.(address, "finished")),
          );
        },
      );
  };

  useEffect(() => {
    if (wt !== null && attachedTo.current !== connection) attach(wt);
  }, [wt, connection]);

  if (error !== null) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (core === null) return <div className={cn("min-h-0 flex-1 bg-term-bg", className)} aria-busy="true" />;
  return (
    <>
      <Terminal
        ref={handle}
        core={core}
        autoResize
        {...(options.cursorBlink === undefined ? {} : { cursorBlink: options.cursorBlink })}
        aria-label={label}
        data-slot="terminal-viewport"
        data-terminal={address}
        className={cn("min-h-0 flex-1 bg-term-bg", options.hollowCursor && "cursor-hollow", className)}
        onReady={attach}
        onData={(data) => send(transformInput === undefined ? data : transformInput(data))}
        onResize={(cols, rows) => stream.current?.resize(cols, rows)}
        onFocus={() => stream.current?.focus(true)}
        onBlur={() => stream.current?.focus(false)}
      />
      <PasteDialog
        paste={paste}
        onCancel={() => setPaste(null)}
        onPaste={(text) => {
          send(text);
          setPaste(null);
        }}
      />
    </>
  );
}
