import type { HcConnection } from "@doriface/client";
import { cn, IconButton } from "@doriface/ui";
import { Columns2, Maximize2, Minimize2, Rows2, X } from "lucide-react";
import type { Axis } from "@doriface/protocol/layout";
import { useActionKeys } from "../keys/use-action-keys.ts";
import type { ReactNode } from "react";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { TerminalPort } from "../terminal/terminal-port.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { machineOf, type Session, terminalTitle } from "./model.ts";
import { picksPane } from "./pane-focus.ts";

export interface PaneProps {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly focused: boolean;
  /** True when the tab holds more than one pane: unfocused-split-opacity dims only those, and each gets a header. */
  readonly split: boolean;
  readonly onFocus: () => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly zoomed: boolean;
  readonly onSplit: (axis: Axis) => void;
  readonly onZoom: () => void;
  readonly onClose: () => void;
  /** The view's input path, for input from outside the pane (dictation); null once the view unmounts. */
  readonly onPort: (port: TerminalPort | null) => void;
  /** Docked under the terminal, inside the card: the voice strip while this pane is dictated into. */
  readonly dock?: ReactNode;
}

/** herdr-app's pane header buttons, each with its shortcut in the tooltip. */
function PaneButtons({
  zoomed,
  onSplit,
  onZoom,
  onClose,
}: Pick<PaneProps, "zoomed" | "onSplit" | "onZoom" | "onClose">) {
  const right = useActionKeys("pane.split:right");
  const down = useActionKeys("pane.split:down");
  const zoom = useActionKeys("pane.zoom");
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
        label={zoomed ? "Show every pane" : "Zoom pane"}
        icon={zoomed ? <Minimize2 /> : <Maximize2 />}
        className={small}
        pressed={zoomed}
        {...(zoom === undefined ? {} : { keys: zoom })}
        onClick={onZoom}
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
export function Pane(props: PaneProps) {
  const { connection, terminal, focused, split, zoomed, onFocus, onEnd, onPort, dock, onSplit, onZoom, onClose } =
    props;
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={(event) => {
        const starting = event.target instanceof Element && event.target.closest('[data-ready="false"]') !== null;
        if (picksPane(starting, focused)) onFocus();
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
          <PaneButtons zoomed={zoomed} onSplit={onSplit} onZoom={onZoom} onClose={onClose} />
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
          onPort={onPort}
        />
      )}
      {dock}
    </section>
  );
}
