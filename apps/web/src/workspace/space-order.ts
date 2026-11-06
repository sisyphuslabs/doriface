import { moveSpace as movedIn } from "@doriface/protocol/layout";
import { useCallback, useRef } from "react";
import { spacePlace } from "./space-place.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

/**
 * Moves listed space `id` to index `to` among its own machine's spaces, as herdr-app's `space.move`: the order is that
 * machine's `herdr-app` document, which every client of the host reads, relayed ones included. Rejects with why it was
 * not written: the space is gone, its layout takes no edits, or the document refused the write.
 */
export async function moveSpace(layouts: readonly MachineLayout[], id: string, to: number): Promise<void> {
  const place = spacePlace(layouts, id);
  if (place === undefined) throw new Error("This space is no longer in the layout.");
  const { readOnly } = place.layout;
  if (readOnly !== null) throw new Error(`The layout cannot take changes now: ${readOnly}`);
  await place.layout.edit((doc) => (doc === null ? null : movedIn(doc, place.space, to)));
}

/** The sidebar's move: a refused write is the notice `refused` shows, never an unhandled rejection. */
export function useSpaceMove(
  layouts: readonly MachineLayout[],
  refused: (message: string) => void,
): (id: string, to: number) => void {
  const latest = useRef({ layouts, refused });
  latest.current = { layouts, refused };
  return useCallback((id: string, to: number): void => {
    void moveSpace(latest.current.layouts, id, to).catch((cause: unknown) => {
      latest.current.refused(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);
}
