import { Copy, ClipboardPaste } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { TerminalSelection } from "./use-touch-selection.ts";

export interface SelectionMenuProps {
  /** Where the hold left the finger and what it selected; null keeps the menu closed. */
  readonly selection: TerminalSelection | null;
  readonly onClose: () => void;
  readonly onCopy: (text: string) => void;
  readonly onPaste: () => void;
}

const ITEM =
  "flex h-11 min-w-24 items-center gap-2 rounded-lg px-3 text-sm text-foreground outline-none active:bg-selected focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring [&_svg]:size-4 [&_svg]:text-muted-foreground";

/** Where the menu sits: above the finger, or below it where the top of the screen is near, kept inside the viewport. */
function place(at: { readonly x: number; readonly y: number }): { readonly left: number; readonly top: number } {
  const width = 148;
  const height = 108;
  const left = Math.min(Math.max(8, at.x - width / 2), Math.max(8, window.innerWidth - width - 8));
  const above = at.y - height - 12;
  return { left, top: above > 8 ? above : Math.min(at.y + 12, window.innerHeight - height - 8) };
}

/**
 * What a held touch in the terminal offers: Copy of what it selected, and Paste into the program. It opens where the
 * finger left the screen, so it sits by the text it acts on, and it offers only Paste with nothing selected. Pressing
 * an item leaves the keyboard where it was: the terminal keeps the focus through the press.
 */
export function SelectionMenu(props: SelectionMenuProps) {
  const { selection, onClose, onCopy, onPaste } = props;
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selection === null) return undefined;
    const elsewhere = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || menu.current?.contains(event.target) === true) return;
      onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    // The press that opened this menu is still in flight: it closes the menu only from the next one.
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 0);
    const press = (event: PointerEvent): void => {
      if (armed) elsewhere(event);
    };
    const scrolled = (): void => onClose();
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      window.clearTimeout(arm);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [selection, onClose]);
  if (selection === null) return null;
  const { text, at } = selection;
  const { left, top } = place(at);
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Selected text"
      style={{ left, top }}
      // The press that picks an item must not take the keyboard off the terminal, which would drop the soft keyboard.
      onPointerDown={(event) => event.preventDefault()}
      className="fixed z-50 flex flex-col rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {text === "" ? null : (
        <button
          type="button"
          role="menuitem"
          className={ITEM}
          onClick={() => {
            onCopy(text);
            onClose();
          }}
        >
          <Copy aria-hidden />
          Copy
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={ITEM}
        onClick={() => {
          onPaste();
          onClose();
        }}
      >
        <ClipboardPaste aria-hidden />
        Paste
      </button>
    </div>,
    document.body,
  );
}
