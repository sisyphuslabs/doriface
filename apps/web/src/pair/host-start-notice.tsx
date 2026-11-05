import { Button, Notice } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import type { HostStartFailure } from "../desktop/bridge.ts";
import { HERDR_CORE_URL, hostStartCopy } from "../desktop/host-start-copy.ts";

interface HostStartNoticeProps {
  readonly failure: HostStartFailure;
  readonly retrying: boolean;
  readonly onRetry: () => void;
  /** Offers Settings beside Retry, where another connection can be chosen instead. */
  readonly settings?: boolean;
}

/** This computer's host did not start: the plain cause, what to do, Retry, and the host's own output behind Details. */
export function HostStartNotice({ failure, retrying, onRetry, settings = false }: HostStartNoticeProps) {
  const copy = hostStartCopy(failure);
  return (
    <Notice
      tone="error"
      title="This computer's host did not start"
      className="w-full max-w-md"
      actions={
        <>
          <Button size="sm" loading={retrying} onClick={onRetry}>
            Retry
          </Button>
          {settings ? (
            <Button size="sm" variant="secondary" render={<Link to="/settings" />}>
              Open settings
            </Button>
          ) : null}
        </>
      }
    >
      <p data-host-start-code={failure.code} className="text-foreground">
        {copy.cause}
      </p>
      <p className="mt-1">
        {copy.next}
        {copy.install === true ? (
          <>
            {" "}
            <a
              className="text-foreground underline underline-offset-2"
              href={HERDR_CORE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Get herdr-core
            </a>
          </>
        ) : null}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs select-none">Details</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-raised p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
          {failure.details}
        </pre>
      </details>
    </Notice>
  );
}
