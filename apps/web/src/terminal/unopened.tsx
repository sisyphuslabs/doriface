import { Button, EmptyState, cn } from "@doriface/ui";

/** A terminal whose attach failed: why, in plain words (openFailure), and Try again, which attaches afresh. */
export function Unopened({
  why,
  className,
  onRetry,
}: {
  readonly why: string;
  readonly className?: string | undefined;
  readonly onRetry: () => void;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col justify-center bg-card", className)}>
      <EmptyState
        title="This terminal didn't open"
        description={why}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
