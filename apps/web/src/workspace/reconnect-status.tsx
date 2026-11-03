import { Spinner, StatusBarItem } from "@doriface/ui";
import { useEffect, useState } from "react";
import { useConnection } from "../connection/store.ts";

function useSecondsUntil(at: number | null, longest: number): number | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (at === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [at]);
  return at === null ? null : Math.max(1, Math.min(longest, Math.ceil((at - now) / 1000)));
}

/** Status bar item while the workspace on screen waits for its connection to come back; typing meanwhile is kept. */
export function ReconnectStatus() {
  const state = useConnection();
  const failed = state.phase === "failed" ? state : null;
  const seconds = useSecondsUntil(failed?.retryAt ?? null, Math.ceil((failed?.retryInMs ?? 0) / 1000));
  if (state.phase === "open" || state.phase === "unconfigured" || state.stale === null) return null;
  const label = seconds === null ? "Reconnecting…" : `Reconnecting in ${seconds} s`;
  return (
    <span role="status" className="flex min-w-0" title={state.phase === "failed" ? state.error.message : undefined}>
      <StatusBarItem icon={<Spinner />}>
        <span className="text-foreground">{label}</span>
      </StatusBarItem>
    </span>
  );
}
