export interface EndHolder {
  readonly stop: () => void;
}

const isAtEnd = (scroller: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean =>
  scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1;

/**
 * Holds a scroller at its end while a reattach replay arrives (#1040). Only a reader who was at the end is held, and the
 * hold lets go if they scroll away, so it never pulls someone out of history they were reading.
 */
export function holdAtEnd(
  scroller: { scrollTop: number; scrollHeight: number; clientHeight: number },
  streaming: () => boolean,
): EndHolder {
  if (!isAtEnd(scroller)) return { stop: () => undefined };
  let stopped = false;
  let wrote = scroller.scrollTop;
  const frame = (): void => {
    if (stopped) return;
    if (Math.abs(scroller.scrollTop - wrote) > 1) return;
    wrote = scroller.scrollHeight;
    scroller.scrollTop = wrote;
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
