import { Button, EmptyState, Notice } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { Monitor, Server } from "lucide-react";
import { useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { desktopBridge, type DesktopBridge } from "../desktop/bridge.ts";
import { useThisComputer } from "../desktop/local-host.ts";
import { Steps } from "./steps.tsx";

const HOST_GUIDE = "https://github.com/sisyphuslabs/doriface#readme";

function LocalFirstRun({ bridge }: { readonly bridge: DesktopBridge }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = (): void => {
    setStarting(true);
    setError(null);
    useThisComputer(bridge, connectionStore).catch((cause: unknown) => {
      setStarting(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10">
      <EmptyState
        icon={<Monitor />}
        title="Use this computer or pair a host"
        description="doriface can run the terminals and agents on this computer, or show the ones on another computer you pair."
        actions={
          <>
            <Button variant="primary" size="lg" loading={starting} onClick={start}>
              Use this computer
            </Button>
            <Button size="lg" render={<Link to="/pair" />}>
              Pair a host
            </Button>
          </>
        }
      />
      {error === null ? null : (
        <Notice tone="error" title="This computer's host did not start" className="w-full max-w-md">
          {error}
        </Notice>
      )}
    </main>
  );
}

/** No host yet: in the desktop app, start one here; elsewhere, the command that starts pairing. */
export function FirstRun() {
  const bridge = desktopBridge();
  if (bridge !== null) return <LocalFirstRun bridge={bridge} />;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10">
      <Steps current={0} />
      <EmptyState
        icon={<Server />}
        size="screen"
        title="Connect to a host"
        description="doriface shows the terminals and agents running on a computer with herdr-core. Start the host there, then pair this device."
        actions={
          <>
            <Button variant="primary" size="lg" render={<Link to="/pair" />}>
              Pair a host
            </Button>
            <Button variant="ghost" size="lg" render={<a href={HOST_GUIDE} target="_blank" rel="noreferrer" />}>
              How to start a host
            </Button>
          </>
        }
      >
        <code className="rounded-md bg-raised px-3 py-2 text-sm text-foreground">doriface-host pair</code>
      </EmptyState>
    </main>
  );
}
