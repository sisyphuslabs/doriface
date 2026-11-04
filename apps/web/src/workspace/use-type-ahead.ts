import { useCallback, useEffect, useMemo, useRef } from "react";
import { type HeldInput, keyInit, replay, terminalInput } from "./type-ahead.ts";

export interface TypeAhead {
  /** Takes the keyboard for a terminal being started, before its address is known; returns the hold. */
  readonly hold: () => number;
  /** Hands the hold's input to the terminal at `address` once its view has mounted; the newest hold also gets focus. */
  readonly deliver: (hold: number, address: string) => void;
  /** The terminal never came: focus goes back where it was and the held input is dropped. */
  readonly release: (hold: number) => void;
  /** The element that holds the keyboard meanwhile; render it once, out of sight. */
  readonly catcher: React.RefObject<HTMLTextAreaElement | null>;
}

/** How long a started terminal's view may take to mount before its held input is given up. */
const MOUNT_BUDGET_MS = 15_000;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

export function useTypeAhead(): TypeAhead {
  const catcher = useRef<HTMLTextAreaElement | null>(null);
  const held = useRef(new Map<number, HeldInput[]>());
  const before = useRef(new Map<number, Element | null>());
  const next = useRef(0);
  const newest = useRef<number | null>(null);

  useEffect(() => {
    const input = catcher.current;
    if (input === null) return undefined;
    const into = (each: HeldInput): void => {
      if (newest.current !== null) held.current.get(newest.current)?.push(each);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // A key the app already took (a second New tab, the palette) is not the terminal's.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || MODIFIERS.has(event.key)) return;
      event.preventDefault();
      into({ kind: "key", init: keyInit(event) });
    };
    const onCompositionEnd = (event: CompositionEvent): void => {
      if (event.data !== "") into({ kind: "text", data: event.data });
      input.value = "";
    };
    const onPaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData("text") ?? "";
      event.preventDefault();
      if (text !== "") into({ kind: "paste", text });
    };
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("compositionend", onCompositionEnd);
    input.addEventListener("paste", onPaste);
    return () => {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("compositionend", onCompositionEnd);
      input.removeEventListener("paste", onPaste);
    };
  }, []);

  const hold = useCallback((): number => {
    next.current += 1;
    const id = next.current;
    held.current.set(id, []);
    before.current.set(id, document.activeElement);
    newest.current = id;
    catcher.current?.focus({ preventScroll: true });
    return id;
  }, []);

  const finish = useCallback((id: number): HeldInput[] => {
    const queue = held.current.get(id) ?? [];
    held.current.delete(id);
    before.current.delete(id);
    if (newest.current === id) newest.current = null;
    return queue;
  }, []);

  const release = useCallback(
    (id: number): void => {
      const was = before.current.get(id) ?? null;
      const last = newest.current === id;
      finish(id);
      if (last && document.activeElement === catcher.current && was instanceof HTMLElement && was.isConnected) {
        was.focus({ preventScroll: true });
      }
    },
    [finish],
  );

  const deliver = useCallback(
    (id: number, address: string): void => {
      const hand = (input: HTMLTextAreaElement): void => {
        const last = newest.current === id;
        const queue = finish(id);
        if (last) input.focus({ preventScroll: true });
        replay(input, queue);
      };
      const now = terminalInput(document, address);
      if (now !== null) return hand(now);
      // The view mounts after the layout takes the address; keys typed meanwhile still land in the hold.
      const watch = new MutationObserver(() => {
        const input = terminalInput(document, address);
        if (input === null) return;
        watch.disconnect();
        clearTimeout(giveUp);
        hand(input);
      });
      const giveUp = setTimeout(() => {
        watch.disconnect();
        release(id);
      }, MOUNT_BUDGET_MS);
      watch.observe(document.body, { childList: true, subtree: true });
    },
    [finish, release],
  );

  return useMemo(() => ({ hold, deliver, release, catcher }), [hold, deliver, release]);
}
