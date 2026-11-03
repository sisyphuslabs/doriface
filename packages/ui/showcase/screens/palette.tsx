import { useState } from "react";
import { CommandPalette } from "../../src/index.ts";
import { COMMANDS } from "../data.ts";
import { ShellFrame } from "./shell.tsx";

/** The palette over the workspace: a dimmed shell, the palette near the top, focus in its input. */
export function PaletteScreen() {
  const [open, setOpen] = useState(true);
  return (
    <ShellFrame>
      {open ? (
        <>
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <div
            role="dialog"
            aria-modal
            aria-label="Command palette"
            className="absolute inset-x-0 top-0 flex justify-center px-3 pt-3 md:pt-[12vh]"
          >
            <CommandPalette commands={COMMANDS} defaultQuery="" onCancel={() => setOpen(false)} />
          </div>
        </>
      ) : null}
    </ShellFrame>
  );
}
