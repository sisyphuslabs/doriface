import type { HcConnection } from "@doriface/client";
import { cn, IconButton } from "@doriface/ui";
import { Columns2, Rows2, X } from "lucide-react";
import type { Axis } from "@doriface/protocol/layout";
import { useActionKeys } from "../keys/use-action-keys.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { machineOf, type Session, terminalTitle } from "./model.ts";

export interface PaneProps {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly focused: boolean;
  /** True when the tab holds more than one pane: unfocused-split-opacity dims only those, and each gets a header. */
  readonly split: boolean;
  readonly onFocus: () => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly onSplit: (axis: Axis) => void;
  readonly onClose: () => void;
}

/** herdr-app's pane header buttons, each with its shortcut in the tooltip. */
function PaneButtons({ onSplit, onClose }: Pick<PaneProps, "onSplit" | "onClose">) {
  const right = useActionKeys("pane.split:right");
  const down = useActionKeys("pane.split:down");
  const close = useActionKeys("pane.close");
  const small = "size-6 [&_svg]:size-3.5";
  return (
    <span className="ml-auto flex shrink-0 items-center">
      <IconButton
        label="Split right"
        icon={<Columns2 />}
        className={small}
        {...(right === undefined ? {} : { keys: right })}
        onClick={() => onSplit("row")}
      />
      <IconButton
        label="Split down"
        icon={<Rows2 />}
        className={small}
        {...(down === undefined ? {} : { keys: down })}
        onClick={() => onSplit("column")}
      />
      <IconButton
        label="Close pane"
        icon={<X />}
        className={small}
        {...(close === undefined ? {} : { keys: close })}
        onClick={onClose}
      />
    </span>
  );
}

/**
 * A terminal card. A tab's only pane has no title bar: its tab names it, the status bar says where it runs, and the
 * tab strip carries its session actions. Inside a split each pane gets a slim header naming its terminal, as herdr-app
 * frames panes only once a tab is split, since the tab can name only one of them.
 */
export function Pane({ connection, terminal, focused, split, onFocus, onEnd, onSplit, onClose }: PaneProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={(event) => {
        // wterm takes focus as it starts; that is not the person picking this pane (see TerminalView's onFocus).
        if (event.target instanceof Element && event.target.closest('[data-ready="false"]') !== null) return;
        // Already the pane in focus: nothing to choose. It may only stand in for a pane still being written (a split's),
        // and writing it would replace that choice.
        if (!focused) onFocus();
      }}
      data-split={split}
      data-focused={focused}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card [&_.wterm]:transition-opacity [&_.wterm]:duration-(--duration-micro)"
    >
      {split ? (
        <header
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 border-b border-border pr-0.5 pl-2.5 text-xs transition-colors duration-(--duration-micro)",
            focused ? "bg-raised text-foreground" : "text-muted-foreground",
          )}
        >
          <h2 title={title} className="min-w-0 truncate">
            {title}
          </h2>
          <PaneButtons onSplit={onSplit} onClose={onClose} />
        </header>
      ) : null}
      {terminal.offline === true && machine !== undefined ? (
        <MachineOffline machine={machine} />
      ) : (
        // A restarted program (a kept terminal's loss) has a new pid: its view attaches to it afresh.
        <TerminalView
          key={terminal.pid ?? undefined}
          connection={connection}
          address={terminal.address}
          pid={terminal.pid ?? null}
          live={terminal.state === "live"}
          focused={focused}
          label={`${title} output`}
          onEnd={onEnd}
        />
      )}
    </section>
  );
}
