import { Notice } from "@doriface/ui";

/**
 * machine.list failed while this device's link to the host is up: plain words first, the host's own answer behind
 * Details (#545). While the link itself is down the connection notice says so, and this is not shown.
 */
export function MachinesListError({ cause, className }: { readonly cause: string; readonly className?: string }) {
  return (
    <Notice tone="error" title="Could not list the machines" {...(className === undefined ? {} : { className })}>
      The host did not answer with its machines. It tries again when they change, or reload the page.
      <details className="mt-2">
        <summary className="cursor-pointer text-xs select-none">Details</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-raised p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
          {cause}
        </pre>
      </details>
    </Notice>
  );
}
