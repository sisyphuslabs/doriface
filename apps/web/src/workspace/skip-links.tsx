import type { MouseEvent } from "react";
import { terminalInput } from "./focus-targets.ts";

const LINK =
  "sr-only rounded-md bg-popover px-3 py-1.5 text-sm text-foreground shadow-(--overlay-shadow) focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-[var(--titlebar-inset-start,0.5rem)] focus-visible:z-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";

function jump(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  event.preventDefault();
  go();
}

/** The first Tab stops on the page: jump past the sidebar into the terminal, or to the sidebar lists. */
export function SkipLinks({ onSidebar }: { readonly onSidebar: () => void }) {
  return (
    <>
      <a href="#terminal" className={LINK} onClick={(event) => jump(event, () => terminalInput()?.focus())}>
        Skip to terminal
      </a>
      <a href="#sidebar" className={LINK} onClick={(event) => jump(event, onSidebar)}>
        Skip to sidebar
      </a>
    </>
  );
}
