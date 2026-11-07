import type { WTerm } from "@wterm/react";
import { useEffect, useState } from "react";
import type { OutputPacer } from "./output-pacer.ts";

/**
 * Whether the pane is on screen. A pane out of view (a hidden tab, a zoomed-away split) is not painted and takes no
 * output until it shows (#560), and waits to re-attach until it is shown, so a hidden tab does not fetch a replay nobody
 * looks at (#639).
 */
export function usePaneVisibility(wt: WTerm | null, pacer: OutputPacer): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (wt === null) return undefined;
    const seen = new IntersectionObserver((entries) => {
      const visible = entries.at(-1)?.isIntersecting ?? true;
      setShown(visible);
      pacer.setVisible(visible);
      wt.setRenderingPaused(!visible);
    });
    seen.observe(wt.element);
    return () => {
      seen.disconnect();
      wt.setRenderingPaused(false);
    };
  }, [wt, pacer]);
  return shown;
}
