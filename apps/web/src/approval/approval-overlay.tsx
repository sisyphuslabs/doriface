import type { HcConnection } from "@doriface/client";
import { ApprovalBanner, approvalAnnouncement } from "@doriface/ui";
import { useEffect, useState } from "react";
import type { Session } from "../workspace/model.ts";
import { useApproval } from "./use-approval.ts";

/**
 * The permission banner pinned over a terminal while its agent waits on a prompt; the terminal below stays usable.
 * Its polite live region is mounted, empty, for as long as the terminal is shown, and the text is written into it after
 * each change, so screen readers announce the prompt appearing and every state after it.
 */
export function ApprovalOverlay({ connection, terminal }: { connection: HcConnection; terminal: Session }) {
  const approval = useApproval(connection, terminal);
  const said = approval === undefined ? "" : approvalAnnouncement(approval.mark.prompt, approval.state);
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(said), [said]);
  return (
    <>
      <p data-approval-live={terminal.address} aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </p>
      {approval === undefined ? null : (
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
      )}
    </>
  );
}
