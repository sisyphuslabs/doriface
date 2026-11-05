import { ContextMenu, MenuItem, cn, skipMenuHandler } from "@doriface/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useRef,
} from "react";
import { currentPlatform } from "../keys/trigger.ts";
import { reorderKeys, reorderStep } from "./reorder-keys.ts";

/** What a machine's group needs to move: present only when more than one machine is listed. */
export interface RowReorder {
  readonly index: number;
  readonly count: number;
  readonly offset: number;
  readonly className: string;
  readonly dragging: boolean;
  readonly lifted: boolean;
  readonly menuOpen: boolean;
  readonly onMenuOpen: (open: boolean) => void;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: { stopPropagation(): void; preventDefault(): void }) => void;
  readonly touching: () => boolean;
  /** Moves this machine to index `to`, by its menu, a key or a drop. */
  readonly onMove: (to: number) => void;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
  readonly onFocus: () => void;
  /** Focus moving to another element forgets the row, so a later reorder does not pull focus back to it. */
  readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
}

/** The header button's part in a reorder: its ref, the move keys and the focus tracking. */
export interface HeaderButton {
  readonly ref: (element: HTMLButtonElement | null) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  readonly "data-reorder-keys": "";
}

export interface MachineGroupProps {
  readonly core: string;
  readonly name: string;
  readonly reorder: RowReorder | undefined;
  /** The machine's header row, given its button's reorder part (undefined when the group cannot move). */
  readonly header: (button: HeaderButton | undefined) => ReactNode;
  readonly children: ReactNode;
}

/**
 * One machine's spaces under its header. With `reorder` the header drags the whole group to a new place, and its menu
 * and keys move it too, as the Machines list's rows did before the spaces lived under their machines.
 */
export function MachineGroup({ core, name, reorder, header, children }: MachineGroupProps) {
  const button = useRef<HTMLButtonElement | null>(null);
  if (reorder === undefined) {
    return (
      <section aria-label={name} className="flex flex-col gap-px">
        {header(undefined)}
        {children}
      </section>
    );
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const step = reorderStep(event, currentPlatform());
    if (step === null) return;
    event.preventDefault();
    event.stopPropagation();
    const to = reorder.index + step;
    if (to >= 0 && to < reorder.count) reorder.onMove(to);
  };
  const handle = (
    <div
      data-machine-row
      onPointerDown={reorder.onPointerDown}
      onClickCapture={reorder.onClickCapture}
      onTouchStart={skipMenuHandler}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        if (!reorder.touching()) return;
        skipMenuHandler(event);
        event.preventDefault();
      }}
      className="select-none"
    >
      {header({
        ref: (element) => {
          button.current = element;
          reorder.buttonRef(element);
        },
        onKeyDown,
        onFocus: reorder.onFocus,
        onBlur: reorder.onBlur,
        "data-reorder-keys": "",
      })}
    </div>
  );
  return (
    <section
      aria-label={name}
      data-drag-id={core}
      {...(reorder.dragging ? { "data-dragging": "" } : {})}
      {...(reorder.lifted ? { "data-lifted": "" } : {})}
      style={reorder.offset === 0 ? undefined : { translate: `0 ${reorder.offset}px` }}
      className={cn(
        "relative flex flex-col gap-px rounded-md",
        reorder.lifted && "bg-raised shadow-overlay",
        reorder.className,
      )}
    >
      <GroupMenu handle={handle} reorder={reorder} button={button} />
      {children}
    </section>
  );
}

interface GroupMenuProps {
  readonly handle: ReactElement;
  readonly reorder: RowReorder;
  readonly button: RefObject<HTMLButtonElement | null>;
}

function GroupMenu({ handle, reorder, button }: GroupMenuProps) {
  const keys = reorderKeys(currentPlatform());
  return (
    <ContextMenu trigger={handle} open={reorder.menuOpen} onOpenChange={reorder.onMenuOpen} finalFocus={button}>
      <MenuItem
        icon={<ArrowUp />}
        disabled={reorder.index === 0}
        keys={keys.up}
        onClick={() => reorder.onMove(reorder.index - 1)}
      >
        Move up
      </MenuItem>
      <MenuItem
        icon={<ArrowDown />}
        disabled={reorder.index === reorder.count - 1}
        keys={keys.down}
        onClick={() => reorder.onMove(reorder.index + 1)}
      >
        Move down
      </MenuItem>
    </ContextMenu>
  );
}
