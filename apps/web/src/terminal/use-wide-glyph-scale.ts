import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import type { TerminalConfig } from "../ghostty/config.ts";
import { wideGlyphScaler } from "./wide-glyph.ts";

/** Sizes `wt`'s wide glyphs for its font, again after the config changes the font or a web font finishes loading. */
export function useWideGlyphScale(wt: WTerm | null, config: TerminalConfig): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const measure = (): void => wt.setWideGlyphScale(wideGlyphScaler(wt.element));
    // The config's stylesheet applies before the next frame.
    const frame = requestAnimationFrame(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [wt, config]);
}
