import type { HcConnection } from "@doriface/client";
import { useLayoutEffect, useRef, useState } from "react";
import { arrange, type Rect } from "../layout/rects.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { LayoutPane, LayoutTab } from "./layout-model.ts";
import type { Session } from "./model.ts";
import { Pane } from "./pane.tsx";
import type { Layout } from "./use-layout.ts";

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
  readonly onEnd: (address: string, end: TerminalEnd) => void;
}

/**
 * Every tab's tree, each pane placed by its rectangle so a split or a close never remounts a terminal: panes are keyed
 * by id and only move. Hidden tabs stay mounted so their streams and scrollback survive tab switches.
 */
export function SplitPanes({ connection, terminals, layout, onEnd }: SplitPanesProps) {
  const [ref, box] = useBoxSize();
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
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
              aria-label={tab.name === "" ? "Tab" : tab.name}
              hidden={!selected}
              className="absolute inset-0"
            >
              {tab.panes.map((pane) => {
                const rect = panes.get(pane.id);
                return rect === undefined ? null : (
                  <div
                    key={pane.id}
                    className="absolute flex"
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                  >
                    <PaneSlot
                      connection={connection}
                      tab={tab}
                      pane={pane}
                      terminal={pane.address === null ? undefined : byAddress.get(pane.address)}
                      focused={selected && layout.focused?.id === pane.id}
                      onFocus={() => layout.focusPane(tab.key, pane.id)}
                      onEnd={onEnd}
                    />
                  </div>
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
}

function PaneSlot({ connection, tab, pane, terminal, focused, onFocus, onEnd }: PaneSlotProps) {
  if (terminal !== undefined) {
    return (
      <Pane
        connection={connection}
        terminal={terminal}
        focused={focused}
        split={tab.panes.length > 1}
        onFocus={onFocus}
        onEnd={onEnd}
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
