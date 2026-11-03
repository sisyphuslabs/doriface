import { Button, EmptyState } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { Steps } from "./steps.tsx";

const HOST_GUIDE = "https://github.com/sisyphuslabs/doriface#readme";

/** No host yet: what doriface needs and the command that starts pairing. */
export function FirstRun() {
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
