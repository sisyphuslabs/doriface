import { RowDropCaret, RowDropIndicator, rowPlacement, useListDrag } from "@doriface/ui";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RowReorder } from "./machine-group.tsx";
import type { MachineEntry } from "./machines.ts";
import { useMachinesContext } from "./use-machines.ts";

/** A machine this list moved, by any path; counted so a second move to the same place is still announced. */
interface Moved {
  readonly core: string;
  readonly count: number;
}

/**
 * The announcement of this person's last saved move: worded once, from the list the save produced (`order`), and read
 * out only while the list stays that way. Another client's order, a machine added or removed, or a move that was not
 * saved clears it; none of them rewords it (#161).
 */
interface Announced {
  readonly moved: Moved;
  readonly text: string | null;
  readonly order: string | null;
}

export interface MachineReorder {
  /** The group's part in a reorder, or undefined when it cannot move (one machine, or `enabled` off). */
  readonly reorderOf: (machine: MachineEntry, index: number) => RowReorder | undefined;
  /** The drop marks and the polite announcement of a move, rendered inside the list. */
  readonly overlay: ReactNode;
}

/**
 * Moving machines in `list` (each group a `[data-drag-id]` element): by drag, by a group's menu and by its keys. The
 * order is the machines' order everywhere (`moveMachine` writes it to the layout document, so it syncs). Focus that the
 * reorder dropped goes straight back to the moved header; focus that went anywhere else since is left there.
 */
export function useMachineReorder(
  list: RefObject<HTMLElement | null>,
  entries: readonly MachineEntry[],
  enabled: boolean,
): MachineReorder {
  const { moveMachine } = useMachinesContext();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focused = useRef<string | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [announced, setAnnounced] = useState<Announced | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const movable = enabled && entries.length > 1;
  const count = useRef(0);
  const move = (core: string, to: number): void => {
    count.current += 1;
    const made = { core, count: count.current };
    setMoved(made);
    const announceOnceSaved = async (): Promise<void> => {
      if (await moveMachine(core, to)) setAnnounced({ moved: made, text: null, order: null });
    };
    void announceOnceSaved();
  };
  const order = entries.map((machine) => machine.core).join("\n");
  const { drag, settle, lifted, touching, onPointerDown, onClickCapture } = useListDrag(
    list,
    entries.map((machine) => machine.core),
    {
      onMove: movable ? move : undefined,
      onStart: () => setMenuFor(null),
      onHoldRelease: (core, x, y) => {
        const row = list.current?.querySelector(`[data-drag-id="${CSS.escape(core)}"] [data-machine-row]`);
        row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      },
    },
  );

  useLayoutEffect(() => {
    if (moved === null || focused.current !== moved.core) return;
    const button = buttons.current.get(moved.core);
    const dropped = document.activeElement === null || document.activeElement === document.body;
    if (button !== undefined && dropped) button.focus();
  }, [moved, entries]);

  useEffect(() => {
    if (announced === null) return;
    if (announced.order === null) {
      const at = entries.findIndex((machine) => machine.core === announced.moved.core);
      const machine = entries[at];
      if (machine === undefined) return setAnnounced(null);
      // The count's parity changes the text each time, so a second move to the same place is still read out.
      const mark = announced.moved.count % 2 === 0 ? "" : "\u00a0";
      const text = `Moved ${machine.name} to position ${at + 1} of ${entries.length}${mark}`;
      return setAnnounced({ ...announced, text, order });
    }
    if (announced.order !== order) setAnnounced(null);
  }, [announced, entries, order]);
  const announcement = announced?.order === order ? (announced.text ?? "") : "";

  const reorderOf = (machine: MachineEntry, index: number): RowReorder | undefined => {
    if (!movable) return undefined;
    const place = rowPlacement(machine.core, index, drag, settle);
    return {
      index,
      count: entries.length,
      offset: place.offset,
      className: place.className,
      dragging: drag?.id === machine.core,
      lifted: lifted === machine.core,
      menuOpen: menuFor === machine.core,
      onMenuOpen: (open) => setMenuFor(open ? machine.core : null),
      onPointerDown: (event) => onPointerDown(event, machine.core, index),
      onClickCapture,
      touching,
      onMove: (to) => {
        focused.current = machine.core;
        move(machine.core, to);
      },
      buttonRef: (element) => {
        if (element === null) buttons.current.delete(machine.core);
        else buttons.current.set(machine.core, element);
      },
      onFocus: () => {
        focused.current = machine.core;
      },
      onBlur: (event) => {
        if (event.relatedTarget !== null) focused.current = null;
      },
    };
  };

  const overlay = (
    <>
      {drag === null ? null : <RowDropIndicator drag={drag} />}
      {drag === null ? null : <RowDropCaret drag={drag} />}
      {/* role="status" is already polite. An explicit aria-live would keep a modal from hiding the workspace: Base UI
          never hides an [aria-live] element's ancestors, and the focus chord reads a hidden workspace as a modal. */}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </>
  );
  return { reorderOf, overlay };
}
