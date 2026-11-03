import type { HcConnection, TerminalStream } from "@doriface/client";
import { cn } from "@doriface/ui";
import { loadGhosttyCore } from "@doriface/ghostty-wasm";
import type { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle, type WTerm } from "@wterm/react";
import { useEffect, useRef, useState } from "react";
import { readDisplay } from "./display.ts";

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
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const stream = useRef<TerminalStream | null>(null);

  useEffect(() => {
    let live = true;
    loadGhosttyCore().then(
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

  const attach = (wt: WTerm): void => {
    const display = readDisplay(wt.element);
    connection
      .attach(
        { terminal: address, cols: wt.cols, rows: wt.rows, history: HISTORY_LINES, display },
        { autoCredit: false },
      )
      .then(
        (attached) => {
          stream.current = attached;
          onStream?.(attached);
          attached.onData((bytes) => {
            handle.current?.write(bytes);
            attached.consumed(bytes.byteLength);
          });
          attached.onClose(() => onClosed?.(address));
          if (focused) wt.focus();
          return attached;
        },
        (cause: unknown) => setError(`Could not open ${address}: ${String(cause)}`),
      );
  };

  if (error !== null) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (core === null) return <div className={cn("min-h-0 flex-1 bg-term-bg", className)} aria-busy="true" />;
  return (
    <Terminal
      ref={handle}
      core={core}
      autoResize
      aria-label={label}
      data-slot="terminal-viewport"
      data-terminal={address}
      className={cn("min-h-0 flex-1 bg-term-bg", className)}
      onReady={attach}
      onData={(data) => stream.current?.write(transformInput === undefined ? data : transformInput(data))}
      onResize={(cols, rows) => stream.current?.resize(cols, rows)}
      onFocus={() => stream.current?.focus(true)}
      onBlur={() => stream.current?.focus(false)}
    />
  );
}
