import { useMemo } from "react";
import { actionKeys, resolveKeymap } from "./keymap.ts";
import { useOverrides } from "./keymap-store.ts";
import { currentPlatform } from "./trigger.ts";

/** An action's shortcut hint from the live keymap, so it follows the platform and the user's rebinds. */
export function useActionKeys(action: string): string[] | undefined {
  const overrides = useOverrides();
  return useMemo(() => {
    const platform = currentPlatform();
    return actionKeys(resolveKeymap(platform, overrides), action, platform);
  }, [overrides, action]);
}
