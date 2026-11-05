import type { HcConnection } from "@doriface/client";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type Axis, type Node, nodeAt, pathTo } from "@doriface/protocol/layout";
import { arrange, type Rect } from "../layout/rects.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { LayoutPane, LayoutTab } from "./layout-model.ts";
import type { Session } from "./model.ts";
import type { PaneSends } from "./pane-sends.ts";
import { Pane } from "./pane.tsx";
import { usePaneMotion, type PaneMotion } from "./pane-motion.ts";
import type { Layout, PaneTarget } from "./use-layout.ts";

/** Space between panes, px: the gap shows the canvas, so panes read as separate cards. */
export const PANE_GAP = 8;

export const panelId = (tab: string): string => `tab-panel-${tab}`;

function useBoxSize(): [React.RefObject<HTMLDivElement | null>, Rect] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { x: 0, y: 0, width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export interface SplitPanesProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
  readonly layout: Layout;
  /** Each tab's title as the strip shows it, so its panel is named the same (an unnamed tab takes its pane's title). */
  readonly titles: ReadonlyMap<string, string>;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly onSplit: (axis: Axis, target: PaneTarget) => void;
  readonly onClose: (address: string) => void;
  readonly sends: PaneSends;
  /** Docked under the focused pane of the tab in view only. */
  readonly dock: ReactNode;
}

/** The axis of the row or column a pane sits in: a fresh pane grows out of its neighbour along it. */
function axisAround(root: Node, pane: string): "row" | "column" | null {
  const path = pathTo(root, pane);
  const parent = path === null ? null : nodeAt(root, path.slice(0, -1));
  const type = parent?.["type"];
  return type === "row" || type === "column" ? type : null;
}

function PaneFrame({ motion, children }: { readonly motion: PaneMotion; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePaneMotion(ref, motion);
  const { rect } = motion;
  return (
    <div
      ref={ref}
      className="absolute flex"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      {children}
    </div>
  );
}

/**
 * Every tab's tree, each pane placed by its rectangle so a split or a close never remounts a terminal: panes are keyed
 * by id and only move. Hidden tabs stay mounted so their streams and scrollback survive tab switches.
 */
export function SplitPanes({
  connection,
  terminals,
  layout,
  titles,
  onEnd,
  sends,
  dock,
  onSplit,
  onClose,
}: SplitPanesProps) {
  const [ref, box] = useBoxSize();
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  const frame = `${box.width}x${box.height}`;
  return (
    <div className="min-h-0 flex-1 p-2">
      <div ref={ref} className="relative h-full w-full">
        {layout.tabs.map((tab) => {
          const selected = tab.key === layout.active?.key;
          const zoomed = selected ? layout.zoomed : null;
          const { panes } = arrange(tab.root, box, PANE_GAP, zoomed);
          return (
            <div
              key={tab.key}
              id={panelId(tab.key)}
              role="tabpanel"
              aria-label={titles.get(tab.key) ?? (tab.name === "" ? "Tab" : tab.name)}
              hidden={!selected}
              className="absolute inset-0"
            >
              {tab.panes.map((pane) => {
                const rect = panes.get(pane.id);
                if (rect === undefined) return null;
                const grow = pane.id === layout.fresh ? axisAround(tab.root, pane.id) : null;
                const bump = layout.bumped?.pane === pane.id ? layout.bumped : null;
                return (
                  <PaneFrame key={pane.id} motion={{ rect, frame, grow, bump }}>
                    <PaneSlot
                      connection={connection}
                      tab={tab}
                      pane={pane}
                      terminal={pane.address === null ? undefined : byAddress.get(pane.address)}
                      focused={selected && layout.focused?.id === pane.id}
                      onFocus={() => layout.focusPane(tab.key, pane.id)}
                      onEnd={onEnd}
                      onSplit={(axis) => onSplit(axis, { tab: tab.key, pane: pane.id })}
                      onClose={() => (pane.address === null ? undefined : onClose(pane.address))}
                      sends={sends}
                      dock={selected && layout.focused?.id === pane.id ? dock : null}
                    />
                  </PaneFrame>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PaneSlotProps {
  readonly connection: HcConnection;
  readonly tab: LayoutTab;
  readonly pane: LayoutPane;
  readonly terminal: Session | undefined;
  readonly focused: boolean;
  readonly onFocus: () => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly onSplit: (axis: Axis) => void;
  readonly onClose: () => void;
  readonly sends: PaneSends;
  readonly dock: ReactNode;
}

function PaneSlot({
  connection,
  tab,
  pane,
  terminal,
  focused,
  onFocus,
  onEnd,
  sends,
  dock,
  onSplit,
  onClose,
}: PaneSlotProps) {
  if (terminal !== undefined) {
    return (
      <Pane
        connection={connection}
        terminal={terminal}
        focused={focused}
        split={tab.panes.length > 1}
        onFocus={onFocus}
        onEnd={onEnd}
        onSplit={onSplit}
        onClose={onClose}
        onPort={sends.onPort(terminal.address)}
        dock={dock}
      />
    );
  }
  const text =
    pane.mod !== null ? `herdr-app's ${pane.mod} panel opens in herdr-app.` : "Waiting for this terminal to start…";
  return (
    <section
      aria-label={pane.mod === null ? "Starting terminal" : `${pane.mod} panel`}
      data-focused={focused}
      tabIndex={-1}
      onFocus={onFocus}
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground"
    >
      {text}
    </section>
  );
}
