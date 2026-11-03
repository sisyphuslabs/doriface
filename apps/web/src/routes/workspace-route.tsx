import { Button, EmptyState, Notice, Spinner } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { PlugZap } from "lucide-react";
import { hostFailure } from "../connection/host-failure.ts";
import { connectionStore, useConnection } from "../connection/store.ts";
import { FirstRun } from "../pair/first-run.tsx";
import { useOnline } from "../pwa/use-online.ts";
import { lazy, Suspense } from "react";

const Workspace = lazy(() => import("../workspace/workspace.tsx").then((module) => ({ default: module.Workspace })));

/** The workspace once connected (and while it reconnects); otherwise what is happening and the next step. */
export function WorkspaceRoute() {
  const state = useConnection();
  const online = useOnline();
  const shown =
    state.phase === "open"
      ? state.connection
      : state.phase === "connecting" || state.phase === "failed"
        ? state.stale
        : null;
  if (shown !== null) {
    return (
      <Suspense fallback={<div className="h-dvh bg-background" aria-busy="true" />}>
        <Workspace connection={shown} />
      </Suspense>
    );
  }

  if (state.phase === "unconfigured" && online) return <FirstRun />;
  const settings = (
    <Button render={<Link to="/settings" />} variant={state.phase === "unconfigured" ? "primary" : "secondary"}>
      Open settings
    </Button>
  );
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        {online ? null : (
          <Notice tone="warning" title="You are offline">
            The app works offline, but reaching your host needs a network.
          </Notice>
        )}
        {state.phase === "connecting" ? (
          <EmptyState icon={<Spinner />} title="Connecting to your host" description="Opening the session." />
        ) : state.phase === "failed" ? (
          <EmptyState
            icon={<PlugZap aria-hidden className="size-5" />}
            title="Cannot reach your host"
            description={
              state.retryInMs === null
                ? hostFailure(state.error)
                : `${hostFailure(state.error)} Trying again in ${Math.round(state.retryInMs / 1000)} s.`
            }
            actions={
              state.retryInMs === null ? (
                settings
              ) : (
                <>
                  <Button variant="primary" onClick={() => connectionStore.start()}>
                    Try now
                  </Button>
                  {settings}
                </>
              )
            }
          />
        ) : null}
      </div>
    </main>
  );
}
