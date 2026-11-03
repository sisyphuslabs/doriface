import type { Terminal } from "@doriface/protocol";
import { CommandPalette } from "@doriface/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { resolveKeymap } from "../keys/keymap.ts";
import { useOverrides } from "../keys/keymap-store.ts";
import { runAction } from "../keys/dispatcher.ts";
import { currentPlatform } from "../keys/trigger.ts";
import { choiceOf, paletteCommands } from "./palette-commands.ts";

export interface PaletteProps {
  readonly terminals: readonly Terminal[];
  readonly host: string;
  readonly route: string;
  readonly onOpenTerminal: (address: string) => void;
  readonly onClose: () => void;
}

/** The palette over the dimmed workspace, near the top; Escape or the backdrop closes it. */
export function Palette({ terminals, host, route, onOpenTerminal, onClose }: PaletteProps) {
  const navigate = useNavigate();
  const overrides = useOverrides();
  const commands = useMemo(() => {
    const platform = currentPlatform();
    return paletteCommands({ terminals, host, route, platform, keymap: resolveKeymap(platform, overrides) });
  }, [terminals, host, route, overrides]);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => frame.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus(), []);
  const run = (id: string): void => {
    onClose();
    const choice = choiceOf(id);
    if (choice.kind === "agent") onOpenTerminal(choice.address);
    else if (choice.kind === "settings") void navigate({ to: "/settings" });
    else runAction(choice.id);
  };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        aria-label="Command palette"
        ref={frame}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onClose();
        }}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 md:pt-[12vh] [&>*]:pointer-events-auto"
      >
        <CommandPalette commands={commands} onRun={run} onCancel={onClose} />
      </div>
    </>
  );
}
