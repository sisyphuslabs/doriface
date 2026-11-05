// Type-ahead for a terminal that is still being started: from the moment a new tab or split is asked for, the keyboard
// belongs to the terminal that will appear, not to the one that had focus. Keys are held here and replayed into the new
// terminal's own input once it exists, so the terminal emulator encodes them exactly as if they had been typed there.

/** One held input, in the order it was typed. */
export type HeldInput =
  | { readonly kind: "key"; readonly init: KeyboardEventInit }
  | { readonly kind: "text"; readonly data: string }
  | { readonly kind: "paste"; readonly text: string };

/** The parts of a key press the terminal reads; enough to rebuild it as the same press. */
export function keyInit(event: KeyboardEvent): KeyboardEventInit {
  return {
    key: event.key,
    code: event.code,
    location: event.location,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  };
}

/** Replays held input into a terminal's input element, in order: each key as a press and release, text as composed. */
export function replay(input: HTMLTextAreaElement, held: readonly HeldInput[]): void {
  for (const each of held) {
    if (each.kind === "key") {
      input.dispatchEvent(new KeyboardEvent("keydown", each.init));
      input.dispatchEvent(new KeyboardEvent("keyup", each.init));
    } else if (each.kind === "text") {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: each.data }));
    } else {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", each.text);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }
  }
}

/** The input element of the terminal at `address`, once its view has mounted. */
export function terminalInput(root: ParentNode, address: string): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>(`[data-terminal="${CSS.escape(address)}"] textarea`);
}
