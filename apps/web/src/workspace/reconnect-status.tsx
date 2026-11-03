import { Spinner, StatusBarItem } from "@doriface/ui";
import { useConnection } from "../connection/store.ts";

/** Status bar item while the workspace on screen waits for its connection to come back; typing meanwhile is kept. */
export function ReconnectStatus() {
  const state = useConnection();
  if (state.phase === "open" || state.phase === "unconfigured" || state.stale === null) return null;
  const label =
    state.phase === "failed" && state.retryInMs !== null
      ? `Reconnecting in ${Math.round(state.retryInMs / 1000)} s`
      : "Reconnecting…";
  return (
    <span role="status" className="flex min-w-0" title={state.phase === "failed" ? state.error.message : undefined}>
      <StatusBarItem icon={<Spinner />}>
        <span className="text-foreground">{label}</span>
      </StatusBarItem>
    </span>
  );
}
