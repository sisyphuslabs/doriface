import type { HcConnection } from "@doriface/client";
import type { JsonObject, MachineView } from "@doriface/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DocCalls, type DocEdit, LAYOUT_DOC, LayoutDoc } from "@doriface/protocol/layout";

/** One machine's layout as this screen can show it: `doc` is the last one read, and `readOnly` says why it is frozen. */
export interface MachineLayout {
  /** null for this core, else what this core calls the machine now. */
  readonly machine: string | null;
  /** null for this core, else the machine's permanent id (tab keys survive a rename). */
  readonly machineId: string | null;
  readonly doc: JsonObject | null;
  readonly loaded: boolean;
  /** Why edits are refused now, or null when they are taken. */
  readonly readOnly: string | null;
  readonly edit: (change: DocEdit) => Promise<boolean>;
}

const docCalls = (connection: HcConnection): DocCalls => ({
  get: (on) => connection.call("doc.get", on === null ? { name: LAYOUT_DOC } : { name: LAYOUT_DOC, on }),
  set: (on, value, version) =>
    connection.call(
      "doc.set",
      on === null ? { name: LAYOUT_DOC, value, version } : { name: LAYOUT_DOC, on, value, version },
    ),
});

/** Why a machine's layout takes no edits while it is still being read. */
export const LAYOUT_LOADING = "the layout is loading";

/** A machine's edits: through its live document, or refused with why when it has none (not connected). */
export function docEdit(live: Pick<LayoutDoc, "edit"> | undefined): (change: DocEdit) => Promise<boolean> {
  if (live === undefined)
    return () => Promise.reject(new Error("The layout cannot take changes now: the machine is not connected"));
  return (change) => live.edit(change);
}

/** The last document read per core and machine id, so a machine that drops keeps its tabs on screen (read-only). */
const lastRead = new Map<string, JsonObject | null>();

/**
 * The herdr-app document of this core and of every connected added machine, read now and again on each `doc` event the
 * feed reports (`heard`). A machine that is not connected shows the last document read from it and takes no edits.
 */
export function useLayoutDocs(
  connection: HcConnection,
  machines: readonly MachineView[],
): { readonly layouts: readonly MachineLayout[]; readonly heard: (machine: string | null, version: number) => void } {
  const core = connection.hello.core.id;
  const docs = useRef(new Map<string | null, LayoutDoc>());
  const [, rerender] = useState(0);
  const connected = machines.filter((machine) => machine.state === "connected").map((machine) => machine.name);
  const names = connected.join("\u0000");

  useEffect(() => {
    const calls = docCalls(connection);
    const want = new Set<string | null>([null, ...(names === "" ? [] : names.split("\u0000"))]);
    for (const machine of docs.current.keys()) if (!want.has(machine)) docs.current.delete(machine);
    for (const machine of want) {
      if (docs.current.has(machine)) continue;
      const doc = new LayoutDoc(calls, machine, () => rerender((count) => count + 1));
      docs.current.set(machine, doc);
      void doc.refresh();
    }
    rerender((count) => count + 1);
  }, [connection, names]);
  useEffect(() => () => docs.current.clear(), [connection]);

  const heard = useCallback((machine: string | null, version: number): void => {
    void docs.current.get(machine)?.heard(version);
  }, []);

  const layouts = [null, ...machines].map((view): MachineLayout => {
    const machine = view === null ? null : view.name;
    const machineId = view === null ? null : view.id;
    const cacheKey = `${core}|${machineId ?? ""}`;
    const live = docs.current.get(machine);
    const state = live?.state;
    if (state?.phase === "ready") lastRead.set(cacheKey, state.doc);
    const kept = lastRead.get(cacheKey);
    const readOnly =
      state === undefined
        ? "the machine is not connected"
        : state.phase === "ready"
          ? null
          : state.phase === "unreadable"
            ? `this layout has ${state.reason}, which this version of doriface cannot edit`
            : state.phase === "loading"
              ? LAYOUT_LOADING
              : state.reason;
    return {
      machine,
      machineId,
      doc: state?.phase === "ready" ? state.doc : (kept ?? null),
      loaded: state?.phase === "ready" || kept !== undefined,
      readOnly,
      edit: docEdit(live),
    };
  });
  return { layouts, heard };
}
