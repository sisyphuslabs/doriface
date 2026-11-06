import { useEffect, useMemo } from "react";
import { marksInView, panesInView, type Session, withAttention } from "./attention.ts";
import type { Layout } from "./use-layout.ts";

/**
 * The sessions as this screen reads them for attention (#611): an agent that finished while its pane was not on screen
 * reads done until this screen shows that pane, and idle here from then on. The pane in view counts as looked at, so an
 * agent finishing on screen asks for nobody. `open` is the terminal a phone shows full screen, null on a desktop that
 * shows a tab. What was looked at is written into this screen's view (`View.seen`), never into the shared document and
 * never for another device.
 */
export function useAttention(
  terminals: readonly Session[],
  layout: Pick<Layout, "active" | "zoomed" | "seen" | "remember">,
  open: string | null,
): readonly Session[] {
  const { active, zoomed, seen, remember } = layout;
  const inView = useMemo(() => (open === null ? panesInView(active, zoomed) : [open]), [open, active, zoomed]);
  const watched = useMemo(() => marksInView(terminals, inView), [terminals, inView]);
  useEffect(() => remember(watched), [remember, watched]);
  return useMemo(() => withAttention(terminals, { ...seen, ...watched }), [terminals, seen, watched]);
}
