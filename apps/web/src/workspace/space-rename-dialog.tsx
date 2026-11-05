import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toSpaces } from "./model.ts";
import { RenameDialog } from "./rename-dialog.tsx";
import { sessionCalls } from "./session-actions.ts";
import { SpaceRenameContext, type SpaceRenaming } from "./space-rename-context.ts";
import { renameSpace, spaceNameProblem } from "./space-rename.ts";
import { sidebarPrefs } from "./sidebar-prefs.ts";

export interface SpaceRenameProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  /** The space whose Rename question is open (the sidebar's menu, or the palette for the session in view), or null. */
  readonly ask: string | null;
  readonly onAsk: (id: string | null) => void;
  readonly children: ReactNode;
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** This device keeps the space's avatar colour under its new id, as a rename is the same space. */
function keepColor(from: string, to: string): void {
  const { colors } = sidebarPrefs.value;
  const color = colors[from];
  if (color !== undefined && colors[to] === undefined) sidebarPrefs.update({ colors: { ...colors, [to]: color } });
}

/** Renaming spaces for everything inside it (SpaceRenameContext), and the Rename question for the space asked about. */
export function SpaceRename({ connection, terminals, ask, onAsk, children }: SpaceRenameProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name the question asks with, read as it opens: it stays while the rename it starts reaches the list.
  const [asked, setAsked] = useState<{ readonly id: string | null; readonly name: string }>({ id: null, name: "" });
  if (asked.id !== ask) {
    setAsked({ id: ask, name: toSpaces(terminals).find((space) => space.id === ask)?.name ?? "" });
    setBusy(false);
    setError(null);
  }
  // Read when a rename is checked and written, so a context value made before the latest list never acts on an older one.
  const latest = useRef(terminals);
  latest.current = terminals;
  const renaming = useMemo<SpaceRenaming>(
    () => ({
      ask: onAsk,
      problem: (id, name) => spaceNameProblem(latest.current, id, name),
      rename: async (id, name) => {
        const problem = spaceNameProblem(latest.current, id, name);
        if (problem !== null) throw new Error(problem);
        keepColor(id, await renameSpace(sessionCalls(connection), latest.current, id, name));
      },
    }),
    [connection, onAsk],
  );
  const submit = (id: string, name: string): void => {
    const problem = renaming.problem(id, name);
    if (problem !== null) return setError(problem);
    setBusy(true);
    setError(null);
    renaming.rename(id, name).then(
      () => onAsk(null),
      (cause: unknown) => {
        setBusy(false);
        setError(messageOf(cause));
      },
    );
  };
  return (
    <SpaceRenameContext value={renaming}>
      {children}
      {ask === null ? null : (
        <RenameDialog
          title={asked.name}
          busy={busy}
          error={error}
          description="Every device of this machine shows the new name."
          onRename={(name) => submit(ask, name)}
          onCancel={() => onAsk(null)}
        />
      )}
    </SpaceRenameContext>
  );
}
