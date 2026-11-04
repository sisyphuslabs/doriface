import { useEffect, useState } from "react";

export interface ViewportBox {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

/**
 * How far the soft keyboard reaches up from the bottom of the layout viewport, in CSS px: iOS Safari and Chrome on
 * Android shrink the visual viewport over the keyboard and leave the layout viewport alone. A pinch zoom shrinks it
 * too, so a zoomed viewport reads as no keyboard.
 */
export function keyboardInset(layoutHeight: number, viewport: ViewportBox): number {
  if (Math.abs(viewport.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

/**
 * A layout viewport this much shorter than its tallest at the same width has a keyboard in it (a browser that resizes
 * the page for the keyboard instead of overlaying it): more than a toolbar collapsing, less than any phone keyboard.
 */
const LAYOUT_KEYBOARD_MIN = 150;
/** The tallest layout viewport seen at a width, kept across screens so one opened under a keyboard still knows. */
const tallest = { width: 0, height: 0 };

function layoutShrunk(): boolean {
  if (window.innerWidth !== tallest.width) Object.assign(tallest, { width: window.innerWidth, height: 0 });
  tallest.height = Math.max(tallest.height, window.innerHeight);
  return tallest.height - window.innerHeight >= LAYOUT_KEYBOARD_MIN;
}

const typingIn = (scope: HTMLElement | null): boolean => {
  const active = document.activeElement;
  return scope !== null && active instanceof HTMLTextAreaElement && scope.contains(active);
};

/**
 * The soft keyboard over `scope`: whether it is up for a terminal in it, and its inset over the page. On a touch screen
 * it is up while a terminal has the text focus and the keyboard takes room, whichever way the browser makes it: by
 * shrinking the visual viewport over the page (the inset) or the layout viewport itself (the page is shorter, so the
 * inset stays 0). A focus without a tap raises no keyboard on iOS, so the focus alone does not count there; with a
 * fine pointer there is no soft keyboard, so it does. A keyboard that closes by its own key while the terminal keeps
 * focus (Android's back, iPadOS's hide key) blurs the terminal, so the page agrees with the screen.
 */
export function useSoftKeyboard(scope: HTMLElement | null): { readonly up: boolean; readonly inset: number } {
  const [typing, setTyping] = useState(false);
  const [keyboard, setKeyboard] = useState({ open: false, inset: 0 });
  useEffect(() => {
    const abort = new AbortController();
    const follow = (): void => queueMicrotask(() => setTyping(typingIn(scope)));
    document.addEventListener("focusin", follow, { signal: abort.signal });
    document.addEventListener("focusout", follow, { signal: abort.signal });
    follow();
    const viewport = window.visualViewport;
    let wasOpen = false;
    const measure = (): void => {
      const inset = viewport === null ? 0 : keyboardInset(window.innerHeight, viewport);
      const open = inset > 0 || layoutShrunk();
      if (wasOpen && !open && typingIn(scope) && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      wasOpen = open;
      setKeyboard({ open, inset });
    };
    window.addEventListener("resize", measure, { signal: abort.signal });
    viewport?.addEventListener("resize", measure, { signal: abort.signal });
    viewport?.addEventListener("scroll", measure, { signal: abort.signal });
    measure();
    return () => abort.abort();
  }, [scope]);
  const touch = window.matchMedia("(pointer: coarse)").matches;
  return { up: typing && (keyboard.open || !touch), inset: keyboard.inset };
}
