import { docSpaces } from "@doriface/protocol/layout";
import { spaceKey } from "../layout/view.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

/** A listed space's place: its machine's layout, and that space's id in that machine's document. */
export interface SpacePlace {
  readonly layout: MachineLayout;
  readonly space: string;
}

/** The layout holding listed space `id` (a `spaceKey`), and that space's id in it; undefined when no document lists it. */
export function spacePlace(layouts: readonly MachineLayout[], id: string): SpacePlace | undefined {
  for (const layout of layouts) {
    const space =
      layout.doc === null
        ? undefined
        : docSpaces(layout.doc).find((each) => spaceKey(layout.machineId, each.id) === id);
    if (space !== undefined) return { layout, space: space.id };
  }
  return undefined;
}
