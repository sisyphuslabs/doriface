import { RowDropCaret, RowDropIndicator, type Space, cn, rowPlacement, useListDrag } from "@doriface/ui";
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { resolveKeymap } from "../keys/keymap.ts";
import { useOverrides } from "../keys/keymap-store.ts";
import { currentPlatform } from "../keys/trigger.ts";
import { reorderKeys, reorderStep } from "./reorder-keys.ts";

/** What a space row needs to move: present only when its machine's list holds more than one space it may reorder. */
export interface SpaceReorder {
  readonly index: number;
  readonly count: number;
  /** Moves this space to index `to`, by its menu, its keys or a drop. */
  readonly move: (to: number) => void;
  /** Each direction's first chord, for the menu's chips; undefined when nothing is bound to it. */
  readonly keys: { readonly up: readonly string[] | undefined; readonly down: readonly string[] | undefined };
  /** The move keys, on the element the row's button is focused in. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface SpaceListProps {
  readonly spaces: readonly Space[];
  /** Moves space `id` to index `to`; undefined leaves the rows still (one space, the icon rail, or no layout to write). */
  readonly move: ((id: string, to: number) => void) | undefined;
  readonly onDoubleClick: ((space: Space) => void) | undefined;
  readonly className?: string;
  readonly row: (space: Space, reorder: SpaceReorder | undefined) => ReactNode;
}

const STILL = { offset: 0, className: "" } as const;

/**
 * Whether a release at this point keeps the row in `list`. Another machine's space rows refuse it, as herdr refuses a
 * space dragged onto another machine's row; a point over anything else (a header, a notice, a terminal) leaves the
 * landing where the drag put it.
 */
function staysIn(list: HTMLElement | null, clientX: number, clientY: number): boolean {
  if (list === null) return true;
  for (const other of document.querySelectorAll("[data-space-list]")) {
    if (other === list) continue;
    const box = other.getBoundingClientRect();
    if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) return false;
  }
  return true;
}

/**
 * One machine's spaces as a list whose rows drag into a new order, each row's menu and keys moving it too. The order the
 * drop writes is the machine's layout document, so every device reads it; a drop the list does not take changes nothing.
 */
export function SpaceList({ spaces, move, onDoubleClick, className, row }: SpaceListProps) {
  const list = useRef<HTMLDivElement | null>(null);
  const [said, setSaid] = useState("");
  const overrides = useOverrides();
  const keymap = useMemo(() => resolveKeymap(currentPlatform(), overrides), [overrides]);
  const chips = reorderKeys(currentPlatform(), keymap);
  const onMove = move === undefined || spaces.length < 2 ? undefined : move;
  const moveTo = (space: Space, to: number): void => {
    if (onMove === undefined) return;
    onMove(space.id, to);
    setSaid(`Moved ${space.name} to position ${to + 1} of ${spaces.length}`);
  };
  const { drag, settle, onPointerDown, onClickCapture } = useListDrag(
    list,
    spaces.map((space) => space.id),
    {
      onMove: (id, to) => {
        const space = spaces.find((each) => each.id === id);
        if (space !== undefined) moveTo(space, to);
      },
      canDrop: ({ clientX, clientY }) => staysIn(list.current, clientX, clientY),
    },
  );
  const onKeyMove = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    if (onMove === undefined) return;
    const step = reorderStep(event, currentPlatform(), keymap);
    const moving = spaces[index];
    if (step === null || moving === undefined) return;
    const to = index + step;
    if (spaces[to] === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    moveTo(moving, to);
  };
  const reorderOf = (space: Space, index: number): SpaceReorder | undefined =>
    onMove === undefined
      ? undefined
      : {
          index,
          count: spaces.length,
          move: (to) => moveTo(space, to),
          keys: chips,
          onKeyDown: (event) => onKeyMove(event, index),
        };
  return (
    <div ref={list} data-space-list className={cn("relative flex flex-col gap-px", className)}>
      {drag === null ? null : <RowDropIndicator drag={drag} />}
      {drag === null ? null : <RowDropCaret drag={drag} />}
      {/* role="status" is already polite: the move is read out once, as the Machines list's own move is. */}
      {onMove === undefined ? null : (
        <span role="status" className="sr-only">
          {said}
        </span>
      )}
      {spaces.map((space, index) => {
        const place = onMove === undefined ? STILL : rowPlacement(space.id, index, drag, settle);
        return (
          <div
            key={space.id}
            data-space-row
            {...(onMove === undefined ? {} : { "data-drag-id": space.id })}
            {...(drag?.id === space.id ? { "data-dragging": "" } : {})}
            style={place.offset === 0 ? undefined : { translate: `0 ${place.offset}px` }}
            className={cn("relative", place.className)}
            {...(onMove === undefined
              ? {}
              : { onPointerDown: (event) => onPointerDown(event, space.id, index), onClickCapture })}
            {...(onDoubleClick === undefined ? {} : { onDoubleClick: () => onDoubleClick(space) })}
          >
            {row(space, reorderOf(space, index))}
          </div>
        );
      })}
    </div>
  );
}
