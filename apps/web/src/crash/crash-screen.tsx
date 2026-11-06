import { Button } from "@doriface/ui";
import { CircleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { copyText, type CopyOutcome } from "./copy-text.ts";
import { crashDetails } from "./crash-details.ts";

export interface CrashScreenProps {
  readonly error: unknown;
  /** Draws the screen that threw again (a route's error); without it only Reload is offered. */
  readonly onRetry?: () => void;
}

/**
 * What the window shows when a render error reached the app or a whole screen. It needs no provider, so it still draws
 * when one of them is what threw. An installed app has no reload button of its own: Reload is that button.
 */
export function CrashScreen({ error, onRetry }: CrashScreenProps) {
  const [details] = useState(() =>
    crashDetails(error, { route: location.pathname, userAgent: navigator.userAgent, at: new Date() }),
  );
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const block = useRef<HTMLPreElement | null>(null);
  const [open, setOpen] = useState(false);
  const select = (): void => {
    setOpen(true);
    const pre = block.current;
    if (pre === null) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <div role="alert" className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-2">
          <CircleAlert aria-hidden className="size-5 shrink-0 text-status-blocked-text" />
          <h1 className="text-xl font-semibold">doriface stopped drawing</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          It hit an error it could not draw past. Your terminals keep running on the host.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => location.reload()}>
            Reload
          </Button>
          {onRetry === undefined ? null : <Button onClick={onRetry}>Try again</Button>}
          <Button
            variant="ghost"
            onClick={() => void copyText(details, navigator.clipboard ?? undefined, select).then(setCopied)}
          >
            {copied === "copied" ? "Copied" : "Copy details"}
          </Button>
        </div>
        {copied === "selected" ? (
          <p className="text-sm text-muted-foreground">Copying was refused: the details are selected below.</p>
        ) : null}
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <pre
            ref={block}
            className="mt-2 max-h-64 overflow-auto rounded-md bg-raised p-3 font-mono text-xs whitespace-pre-wrap select-text"
          >
            {details}
          </pre>
        </details>
      </div>
    </main>
  );
}
