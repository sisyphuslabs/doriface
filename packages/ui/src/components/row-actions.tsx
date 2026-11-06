import { type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, useRef } from "react";
import { cn } from "../lib/cn.ts";
import { ContextMenu, skipMenuHandler } from "./menu.tsx";

export interface RowWithActionsProps {
  /** The row's own button; it stays the list's stop, and ArrowRight reaches the actions (see the sidebar's roving). */
  readonly row: ReactElement;
  /** Shown over the row's trailing meta on hover, keyboard focus, or while one of their menus is open. */
  readonly actions: ReactNode;
  /**
   * The row's menu items, opened at the pointer by a right-click (Ctrl+click on macOS) or by the Menu key: the same
   * items its "..." action holds, so a right-click finds what the button offers (#699).
   */
  readonly menu?: ReactNode;
  readonly className?: string;
}

const SHOWN =
  "group-hover/row:visible group-focus-within/row:visible group-has-[[data-popup-open]]/row:visible group-data-popup-open/row:visible";
const MASKED =
  "[&:is(:hover,:focus-within,:has([data-popup-open]),[data-popup-open])_[data-row-meta]]:invisible data-popup-open:outline-2 data-popup-open:outline-solid data-popup-open:-outline-offset-2 data-popup-open:outline-ring";

/** A touch keeps the row's own press (a held space row lifts for a drag): only a mouse, a pen or a key opens the menu. */
function skipTouchMenu(event: MouseEvent<HTMLDivElement>): void {
  const press = event.nativeEvent;
  if (press instanceof PointerEvent && press.pointerType === "touch") skipMenuHandler(event);
}

/**
 * Shift+F10 or the Menu key opens the row's menu under the row, on every platform: Blink opens it from those keys only
 * outside macOS, so the row opens it itself and keeps Blink's own from opening it twice.
 */
function openFromKeys(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 8, clientY: box.bottom }),
  );
}

/** A sidebar row with a few trailing actions that take the place of its meta (age, machine, count) when shown. */
export function RowWithActions({ row, actions, menu, className }: RowWithActionsProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const element = (
    <div
      ref={box}
      className={cn("group/row relative min-w-0 rounded-md", MASKED, className)}
      {...(menu === undefined
        ? {}
        : { onTouchStart: skipMenuHandler, onContextMenu: skipTouchMenu, onKeyDown: openFromKeys })}
    >
      {row}
      <span className={cn("invisible absolute inset-y-0 right-1 flex items-center gap-0.5", SHOWN)}>{actions}</span>
    </div>
  );
  if (menu === undefined) return element;
  return (
    <ContextMenu
      trigger={element}
      // An item that opened a dialog (Rename…) has the keyboard: taking it back to the row would lose a name typed at
      // once, as the tab's menu once did (#590). Otherwise the row's own button gets it back.
      finalFocus={() => {
        const holder = document.activeElement;
        if (holder instanceof HTMLElement && holder.closest('[role="dialog"]') !== null) return false;
        return box.current?.querySelector("button") ?? true;
      }}
    >
      {menu}
    </ContextMenu>
  );
}
