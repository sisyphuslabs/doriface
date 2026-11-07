export interface EndHolder {
  readonly stop: () => void;
}

/**
 * Keeps a scroller at its end while a reattach replay arrives (#1040). The reset empties the scroller and leaves it at
 * the top, so the replay's rows climb past the reader; the replay's bytes are the core's to decide, so this holds the
 * one thing that is ours - where the scroller sits while it streams.
 */
export function holdAtEnd(scroller: { scrollTop: number; scrollHeight: number }, streaming: () => boolean): EndHolder {
  let stopped = false;
  const frame = (): void => {
    if (stopped) return;
    scroller.scrollTop = scroller.scrollHeight;
    if (!streaming()) return;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    stop: () => {
      stopped = true;
    },
  };
}
