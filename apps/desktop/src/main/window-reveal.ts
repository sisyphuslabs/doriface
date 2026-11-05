import { FIRST_SHOW_DEADLINE_MS } from "../config/window.ts";

/** The part of the one window its first show needs: showing it, and its first frame and its close. */
export interface RevealedWindow {
  show(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  onReady(listener: () => void): void;
  onClosed(listener: () => void): void;
}

/**
 * Shows a window made with `show: false` on its first frame (`ready-to-show`), or at `deadlineMs` when that frame has
 * not come by then: a GPU process still bringing up the system GL driver can hold it for seconds or forever (#88). The
 * window is already painted with its background colour, so an early show is that colour, never a white flash.
 */
export function revealWhenReady(window: RevealedWindow, deadlineMs = FIRST_SHOW_DEADLINE_MS): void {
  const reveal = (): void => {
    clearTimeout(deadline);
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  const deadline = setTimeout(reveal, deadlineMs);
  window.onReady(reveal);
  window.onClosed(() => clearTimeout(deadline));
}
