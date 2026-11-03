import { useMemo } from "react";
import { useTerminalConfig } from "./config-store.ts";
import { terminalCss } from "./render-css.ts";

/** One stylesheet for every terminal on the page, rebuilt when the config changes. */
export function TerminalStyle() {
  const config = useTerminalConfig();
  const css = useMemo(() => terminalCss(config), [config]);
  return <style data-terminal-config>{css}</style>;
}
