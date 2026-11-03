import type { HcConnection, TerminalStream } from "@doriface/client";
import { cn } from "@doriface/ui";
import { loadGhosttyCore } from "@doriface/ghostty-wasm";
import type { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle, type WTerm } from "@wterm/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { terminalConfigStore, useTerminalConfig } from "../ghostty/config-store.ts";
import { rendererOptions } from "../ghostty/render-options.ts";
import { readDisplay } from "./display.ts";
import { PasteDialog } from "./paste-dialog.tsx";
import { resetsCursor } from "./cursor-reset.ts";
import { readThemeColors } from "./theme-colors.ts";
import { useBehaviors, type PendingPaste } from "./use-behaviors.ts";
import { useTerminalActions } from "./use-terminal-actions.ts";

export interface TerminalViewProps {
  readonly connection: HcConnection;
  readonly address: string;
  readonly focused: boolean;
  readonly label: string;
  readonly className?: string;
  /** Rewrites typed input before it is sent (latched phone modifiers). */
  readonly transformInput?: (data: string) => string;
  readonly onStream?: (stream: TerminalStream | null) => void;
  readonly onClosed?: (address: string) => void;
}

const HISTORY_LINES = 2_000;

/** One libghostty terminal attached to one hc channel; output credit returns once it is written. */
export function TerminalView(props: TerminalViewProps) {
  const { connection, address, focused, label, className, transformInput, onStream, onClosed } = props;
  const config = useTerminalConfig();
  const options = useMemo(() => rendererOptions(config), [config]);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [wt, setWt] = useState<WTerm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState<PendingPaste | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const stream = useRef<TerminalStream | null>(null);

  useEffect(() => {
    let live = true;
    // scrollback-limit applies to new terminals, so the core reads it once.
    const scrollbackLimit = rendererOptions(terminalConfigStore.config).scrollbackBytes;
    loadGhosttyCore({ scrollbackLimit }).then(
      (loaded) => (live ? setCore(loaded) : loaded.dispose()),
      (cause: unknown) => setError(`The terminal renderer failed to load: ${String(cause)}`),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      void stream.current?.close();
      onStream?.(null);
    },
    [onStream],
  );

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
  useBehaviors(wt, stream, options, onUnsafePaste);
  useTerminalActions(wt, stream, focused);

  const attach = (ready: WTerm): void => {
    setWt(ready);
    const display = readDisplay(ready.element);
    connection
      .attach(
        { terminal: address, cols: ready.cols, rows: ready.rows, history: HISTORY_LINES, display },
        { autoCredit: false },
      )
      .then(
        (attached) => {
          stream.current = attached;
          onStream?.(attached);
          attached.onData((bytes) => {
            handle.current?.write(bytes);
            attached.consumed(bytes.byteLength);
            // A cursor reset (the attach replay starts with one) means the default shape: the configured cursor-style.
            if (resetsCursor(bytes)) handle.current?.write(rendererOptions(terminalConfigStore.config).cursorSequence);
          });
          attached.onClose(() => onClosed?.(address));
          if (focused) ready.focus();
          return attached;
        },
        (cause: unknown) => setError(`Could not open ${address}: ${String(cause)}`),
      );
  };

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
        onData={(data) => stream.current?.write(transformInput === undefined ? data : transformInput(data))}
        onResize={(cols, rows) => stream.current?.resize(cols, rows)}
        onFocus={() => stream.current?.focus(true)}
        onBlur={() => stream.current?.focus(false)}
      />
      <PasteDialog
        paste={paste}
        onCancel={() => setPaste(null)}
        onPaste={(text) => {
          stream.current?.write(text);
          setPaste(null);
        }}
      />
    </>
  );
}
