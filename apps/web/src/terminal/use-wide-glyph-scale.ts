import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import type { TerminalConfig } from "../ghostty/config.ts";
import { forgetMeasuredFaces, wideGlyphScaler } from "./face-scales.ts";

/** Sizes `wt`'s wide glyphs for its font, again after the config changes the font or a web font finishes loading. */
export function useWideGlyphScale(wt: WTerm | null, config: TerminalConfig): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const apply = (): void => wt.setWideGlyphScale(wideGlyphScaler(wt.element));
    const fontLoaded = (): void => {
      forgetMeasuredFaces();
      apply();
    };
    // The config's stylesheet applies before the next frame.
    const frame = requestAnimationFrame(apply);
    document.fonts.addEventListener("loadingdone", fontLoaded);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", fontLoaded);
    };
  }, [wt, config]);
}
