import type { HcConnection } from "@doriface/client";
import type { ReactNode } from "react";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { PaneSends } from "./pane-sends.ts";
import type { Session } from "./model.ts";
import { Pane } from "./pane.tsx";

export interface PanesProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
  readonly open: readonly string[];
  readonly active: string | null;
  readonly split: string | null;
  readonly onFocus: (address: string) => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly sends: PaneSends;
  /** Docked under the active (focused) pane only. */
  readonly dock: ReactNode;
}

/**
 * Every open tab stays mounted so its stream and scrollback survive tab switches; hidden
 * tabs keep parsing output. The split shows the active tab beside one other.
 */
export function Panes({ connection, terminals, open, active, split, onFocus, onEnd, sends, dock }: PanesProps) {
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  return (
    <div className="flex min-h-0 flex-1 gap-2 p-2">
      {open.map((address) => {
        const terminal = byAddress.get(address);
        if (terminal === undefined) return null;
        const shown = address === active || address === split;
        return (
          <div
            key={address}
            hidden={!shown}
            className={address === split ? "order-last flex min-w-0 flex-1" : "flex min-w-0 flex-1"}
          >
            <Pane
              connection={connection}
              terminal={terminal}
              focused={address === active}
              split={split !== null}
              onFocus={onFocus}
              onEnd={onEnd}
              onSend={sends.onSend(address)}
              dock={address === active ? dock : null}
            />
          </div>
        );
      })}
    </div>
  );
}
