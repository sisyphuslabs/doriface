import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import type { TerminalConfig } from "../ghostty/config.ts";
import { wideGlyphScaler } from "./face-scales.ts";

/** Sizes `wt`'s wide glyphs for its font, again after the config changes the font or a web font finishes loading. */
export function useWideGlyphScale(wt: WTerm | null, config: TerminalConfig): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const apply = (): void => wt.setWideGlyphScale(wideGlyphScaler(wt.element));
    // The config's stylesheet applies before the next frame.
    const frame = requestAnimationFrame(apply);
    // face-scales.ts drops its measurements on the same event, from a listener added before any view's, so this
    // re-applies with fresh ones.
    document.fonts.addEventListener("loadingdone", apply);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", apply);
    };
  }, [wt, config]);
}
