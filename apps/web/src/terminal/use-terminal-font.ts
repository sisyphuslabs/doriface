import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import type { TerminalConfig } from "../ghostty/config.ts";
import { wideGlyphScaler } from "./face-scales.ts";
import { applyFontMetrics } from "./font-metrics.ts";

/** Applies the font's native cell grid and fallback scales again after a config, font load, or display change. */
export function useTerminalFont(wt: WTerm | null, config: TerminalConfig): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const apply = (): void => {
      applyFontMetrics(wt.element);
      wt.fit();
      wt.setWideGlyphScale(wideGlyphScaler(wt.element));
    };
    // The config's stylesheet applies before the next frame.
    const frame = requestAnimationFrame(apply);
    // face-scales.ts drops its measurements on the same event, from a listener added before any view's, so this
    // re-applies with fresh ones.
    document.fonts.addEventListener("loadingdone", apply);
    window.addEventListener("resize", apply);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", apply);
      window.removeEventListener("resize", apply);
    };
  }, [wt, config]);
}
