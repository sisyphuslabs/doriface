import { useMemo } from "react";
import { actionKeys, resolveKeymap } from "./keymap.ts";
import { useOverrides } from "./keymap-store.ts";
import { currentPlatform } from "./trigger.ts";

const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * The "Go to tab N" chord for tabs 1 to 9 as written on this platform (⌘3, or Ctrl+3 elsewhere), from the live
 * keymap; a position whose action is unbound has none. Index 0 is the first tab.
 */
export function useTabSelectKeys(): readonly (string | undefined)[] {
  const overrides = useOverrides();
  return useMemo(() => {
    const platform = currentPlatform();
    const keymap = resolveKeymap(platform, overrides);
    const joiner = platform === "mac" ? "" : "+";
    return POSITIONS.map((position) => actionKeys(keymap, `tab.select:${position}`, platform)?.join(joiner));
  }, [overrides]);
}
