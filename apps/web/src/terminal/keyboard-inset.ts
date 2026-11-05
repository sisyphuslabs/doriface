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
 * The soft keyboard over `scope`: whether it is up for a terminal in it, and its inset over the page. It is up while a
 * terminal has the text focus and the keyboard takes room, whichever way the browser makes it: by shrinking the visual
 * viewport over the page (the inset) or the layout viewport itself (the page is shorter, so the inset stays 0). The
 * focus alone never counts: a focus without a tap raises no keyboard on iOS, and a fine pointer has none to raise, so
 * the keys say Show keyboard until one takes room (#274). A keyboard that closes by its own key while the terminal
 * keeps focus (Android's back, iPadOS's hide key) blurs the terminal, so the page agrees with the screen.
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
  return { up: typing && keyboard.open, inset: keyboard.inset };
}

const ANY_TOUCH = "(any-pointer: coarse)";

/**
 * Whether every pointer here is fine (a mouse or trackpad, as on a narrow desktop window): such a device has a physical
 * keyboard and no soft keyboard to raise, so the phone shell opens its keys bar itself (#287).
 */
export function useMouseOnly(): boolean {
  const [mouseOnly, setMouseOnly] = useState(() => !window.matchMedia(ANY_TOUCH).matches);
  useEffect(() => {
    const query = window.matchMedia(ANY_TOUCH);
    const follow = (): void => setMouseOnly(!query.matches);
    query.addEventListener("change", follow);
    follow();
    return () => query.removeEventListener("change", follow);
  }, []);
  return mouseOnly;
}
