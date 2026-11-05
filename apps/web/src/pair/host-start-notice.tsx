import { Button, Notice } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { desktopHcChooser, type HostStartFailure } from "../desktop/bridge.ts";
import { HERDR_CORE_URL, hostStartCopy } from "../desktop/host-start-copy.ts";

/** The failures a different hc can fix. */
const HC_FAILURES: ReadonlySet<string> = new Set(["hc-binary-missing", "hc-version-failed"]);

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
  // A desktop app started from the Dock or Start menu reads no HC_BIN: Choose hc is how it is pointed at herdr-core.
  const chooseHc = HC_FAILURES.has(failure.code) ? desktopHcChooser() : null;
  return (
    <Notice tone="error" title="This computer's host did not start" className="w-full max-w-md">
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
      {/* Under the message, not beside it: beside, Retry and Open settings left the message about 120 px at 390 (#265). */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={retrying} onClick={onRetry}>
          Retry
        </Button>
        {chooseHc === null ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={retrying}
            onClick={() => {
              void chooseHc().then((chosen) => (chosen === null ? undefined : onRetry()));
            }}
          >
            Choose hc…
          </Button>
        )}
        {settings ? (
          <Button size="sm" variant="secondary" render={<Link to="/settings" />}>
            Open settings
          </Button>
        ) : null}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs select-none">Details</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-raised p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
          {failure.details}
        </pre>
      </details>
    </Notice>
  );
}
