import type { HcConnection } from "@doriface/client";
import { GIT_FACTS_DOC, type GitFacts, type GitFactsDoc, type MachineView, parseGitFacts } from "@doriface/protocol";
import type { SpaceGit } from "@doriface/ui";
import { createContext, use, useCallback, useEffect, useState } from "react";

/** How often the page reads the facts again; the host writes them on its own cadence. */
const READ_MS = 5_000;

/** A directory's git facts on a machine (undefined for this one), when its host wrote them. */
export type GitFactsOf = (machine: string | undefined, dir: string) => GitFacts | undefined;

/** What a space row says about its git state: nothing on its default branch, in sync and clean. */
export function shownGit(facts: GitFacts | undefined): SpaceGit | undefined {
  if (facts === undefined) return undefined;
  const { branch, detached, onDefault, ahead, behind, dirty } = facts;
  if (!detached && !dirty && ahead === 0 && behind === 0 && onDefault) return undefined;
  const git = { detached, ahead, behind, dirty };
  return branch === undefined ? git : { branch, ...git };
}

export const GitFactsContext = createContext<GitFactsOf>(() => undefined);

export const useGitFactsOf = (): GitFactsOf => use(GitFactsContext);

/** The documents each connected machine's doriface-host (and this machine's) wrote, read again every few seconds. */
export function useGitFacts(connection: HcConnection, machines: readonly MachineView[]): GitFactsOf {
  const names = machines
    .filter((machine) => machine.state === "connected")
    .map((machine) => machine.name)
    .join("\u0000");
  const [docs, setDocs] = useState<ReadonlyMap<string, GitFactsDoc>>(new Map());
  useEffect(() => {
    let live = true;
    const want = ["", ...(names === "" ? [] : names.split("\u0000"))];
    const read = async (): Promise<void> => {
      const results = await Promise.all(
        want.map(async (machine): Promise<readonly [string, GitFactsDoc | undefined]> => {
          try {
            const doc = await connection.call(
              "doc.get",
              machine === "" ? { name: GIT_FACTS_DOC } : { name: GIT_FACTS_DOC, on: machine },
            );
            return [machine, parseGitFacts(doc.value)];
          } catch {
            // An offline machine, or a core that has none: its rows say nothing about git.
            return [machine, undefined];
          }
        }),
      );
      if (!live) return;
      const next = new Map<string, GitFactsDoc>();
      for (const [machine, doc] of results) if (doc !== undefined) next.set(machine, doc);
      setDocs((before) => (JSON.stringify([...before]) === JSON.stringify([...next]) ? before : next));
    };
    void read();
    const timer = setInterval(() => void read(), READ_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [connection, names]);
  return useCallback((machine, dir) => docs.get(machine ?? "")?.dirs[dir], [docs]);
}
