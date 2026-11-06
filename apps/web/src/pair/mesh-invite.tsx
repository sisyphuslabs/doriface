import { Button, EmptyState } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { Server } from "lucide-react";

/**
 * A mesh offer (`&m=1`) admits a machine, and the host closes a device pairing on it with 4401 without answering: this
 * screen replaces that refusal with the step that works. The secret never leaves the link the person already has.
 */
export function MeshInvite() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <EmptyState
        icon={<Server />}
        title="This link adds a machine to a mesh"
        description="It is not an invite for a browser. On the computer you want to add, run doriface-host mesh join with the link the member sent. To use this browser instead, ask a member to open Pair a device on their computer."
        actions={
          <>
            <Button variant="primary" size="lg" render={<a href="/pair" />}>
              Type a pairing code
            </Button>
            <Button variant="ghost" size="lg" render={<Link to="/" />}>
              Back
            </Button>
          </>
        }
      >
        <code className="rounded-md bg-raised px-3 py-2 text-sm text-foreground">
          doriface-host mesh join &lt;link&gt;
        </code>
      </EmptyState>
    </main>
  );
}
