import type { HcConnection } from "@doriface/client";
import { ApprovalBanner } from "@doriface/ui";
import type { Session } from "../workspace/model.ts";
import { useApproval } from "./use-approval.ts";

/** The permission banner pinned over a terminal while its agent waits on a prompt; the terminal below stays usable. */
export function ApprovalOverlay({ connection, terminal }: { connection: HcConnection; terminal: Session }) {
  const approval = useApproval(connection, terminal);
  if (approval === undefined) return null;
  return (
    <div
      data-approval={terminal.address}
      className="pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-center"
    >
      <ApprovalBanner
        prompt={approval.mark.prompt}
        state={approval.state}
        onAnswer={approval.answer}
        onDismiss={approval.dismiss}
        className="pointer-events-auto w-full max-w-2xl"
      />
    </div>
  );
}
