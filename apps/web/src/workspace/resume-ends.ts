import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { useEffect } from "react";
import { type PendingEnd, pendingEnds, type PendingEnds, resumeOf } from "./pending-ends.ts";
import { endSession, isGone, sessionCalls, type SessionCalls } from "./session-actions.ts";

/**
 * Sees through the Ends a closed page left unfinished: one whose calls never left that page ends its program now, one
 * whose program ended is removed, and one about a program that is gone or replaced is dropped. An End that fails here
 * stays pending for the next connection.
 */
export async function resumeEnds(
  ends: PendingEnds,
  get: (address: string) => Promise<Pick<Terminal, "state" | "pid">>,
  calls: SessionCalls,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  const resume = async (end: PendingEnd): Promise<void> => {
    try {
      const step = resumeOf(end, await get(end.address));
      if (step === "end") await endSession(calls, end.address);
      else if (step === "remove") await calls.rm({ terminal: end.address });
      ends.remove(end.address);
    } catch (cause) {
      if (isGone(cause)) ends.remove(end.address);
      else console.error(`finish the End of ${end.address} later: ${String(cause)}`);
    }
  };
  // One session at a time, each read from the core just before it is acted on.
  await ends.list().reduce<Promise<void>>(async (previous, end) => {
    await previous;
    if (stillWanted()) await resume(end);
  }, Promise.resolve());
}

/** Once per connection, finishes the Ends this browser asked of its core that a closed page left unfinished. */
export function useResumeEnds(connection: HcConnection): void {
  useEffect(() => {
    let current = true;
    void resumeEnds(
      pendingEnds(connection.hello.core.id),
      (address) => connection.call("terminal.get", { terminal: address }),
      sessionCalls(connection),
      () => current && !connection.closed,
    );
    return () => {
      current = false;
    };
  }, [connection]);
}
