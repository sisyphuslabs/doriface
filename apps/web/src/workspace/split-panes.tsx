import type { HcConnection } from "@doriface/client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { type Axis, childrenOf, type Node, nodeAt, pathTo, resizeAt, weightOf } from "@doriface/protocol/layout";
import { arrange, type Rect } from "../layout/rects.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { LayoutPane, LayoutTab } from "./layout-model.ts";
import type { Session } from "./model.ts";
import { Pane } from "./pane.tsx";
import { PaneDivider } from "./pane-divider.tsx";
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
}

/** The axis of the row or column a pane sits in: a fresh pane grows out of its neighbour along it. */
function axisAround(root: Node, pane: string): "row" | "column" | null {
  const path = pathTo(root, pane);
  const parent = path === null ? null : nodeAt(root, path.slice(0, -1));
  const type = parent?.["type"];
  return type === "row" || type === "column" ? type : null;
}

function PaneFrame(props: { readonly motion: PaneMotion; readonly hidden: boolean; readonly children: ReactNode }) {
  const { motion, hidden, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  usePaneMotion(ref, motion);
  const { rect } = motion;
  return (
    <div
      ref={ref}
      hidden={hidden}
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
/** A drag of one divider in progress: the tab shows it before it is written. */
interface Preview {
  readonly tab: string;
  readonly container: string;
  readonly index: number;
  readonly delta: number;
}

const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function SplitPanes({ connection, terminals, layout, titles, onEnd, onSplit, onClose }: SplitPanesProps) {
  const [ref, box] = useBoxSize();
  const [preview, setPreview] = useState<Preview | null>(null);
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  // A divider drag lays panes out on every move; like a window resize it plays no motion, its release included.
  const frame = `${box.width}x${box.height}${preview === null ? "" : `:${preview.delta}`}`;
  return (
    <div className="min-h-0 flex-1 p-2">
      <div ref={ref} className="relative h-full w-full">
        {layout.tabs.map((tab) => {
          const selected = tab.key === layout.active?.key;
          const zoomed = selected ? layout.zoomed : null;
          const dragged =
            preview?.tab === tab.key ? resizeAt(tab.root, preview.container, preview.index, preview.delta) : null;
          const root = dragged ?? tab.root;
          const { panes, dividers, containers } = arrange(root, box, PANE_GAP, zoomed);
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
                const placed = panes.get(pane.id);
                const grow = pane.id === layout.fresh ? axisAround(tab.root, pane.id) : null;
                const bump = layout.bumped?.pane === pane.id ? layout.bumped : null;
                // A pane a zoom hides stays mounted, so its stream and scrollback are there when it comes back.
                return (
                  <PaneFrame
                    key={pane.id}
                    motion={{ rect: placed ?? HIDDEN, frame, grow, bump }}
                    hidden={placed === undefined}
                  >
                    <PaneSlot
                      connection={connection}
                      tab={tab}
                      pane={pane}
                      terminal={pane.address === null ? undefined : byAddress.get(pane.address)}
                      focused={selected && layout.focused?.id === pane.id}
                      zoomed={zoomed === pane.id}
                      onFocus={() => layout.focusPane(tab.key, pane.id)}
                      onEnd={onEnd}
                      onSplit={(axis) => onSplit(axis, { tab: tab.key, pane: pane.id })}
                      onZoom={() => {
                        layout.focusPane(tab.key, pane.id);
                        layout.toggleZoom();
                      }}
                      onClose={() => (pane.address === null ? undefined : onClose(pane.address))}
                    />
                  </PaneFrame>
                );
              })}
              {selected && !tab.transient && tab.readOnly === null
                ? dividers.map((divider) => (
                    <PaneDivider
                      key={`${divider.container}:${divider.index}`}
                      divider={divider}
                      container={containers.get(divider.container) ?? box}
                      before={shareBefore(root, divider.container, divider.index)}
                      onPreview={(delta) =>
                        setPreview(
                          delta === null
                            ? null
                            : { tab: tab.key, container: divider.container, index: divider.index, delta },
                        )
                      }
                      onResize={(delta) => layout.resize(divider.container, divider.index, delta)}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The share of a row or column that lies before line `index`, in percent. */
function shareBefore(root: Node, container: string, index: number): number {
  const path = pathTo(root, container);
  const node = path === null ? null : nodeAt(root, path);
  const weights = (node === null ? [] : childrenOf(node)).map((child) => weightOf(child) ?? 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const before = weights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0);
  return total === 0 ? 0 : (100 * before) / total;
}

interface PaneSlotProps {
  readonly connection: HcConnection;
  readonly tab: LayoutTab;
  readonly pane: LayoutPane;
  readonly terminal: Session | undefined;
  readonly focused: boolean;
  readonly onFocus: () => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  readonly zoomed: boolean;
  readonly onSplit: (axis: Axis) => void;
  readonly onZoom: () => void;
  readonly onClose: () => void;
}

function PaneSlot(props: PaneSlotProps) {
  const { connection, tab, pane, terminal, focused, zoomed, onFocus, onEnd, onSplit, onZoom, onClose } = props;
  if (terminal !== undefined) {
    return (
      <Pane
        connection={connection}
        terminal={terminal}
        focused={focused}
        split={tab.panes.length > 1}
        onFocus={onFocus}
        onEnd={onEnd}
        zoomed={zoomed}
        onSplit={onSplit}
        onZoom={onZoom}
        onClose={onClose}
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
