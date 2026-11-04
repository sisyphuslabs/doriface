import { Button, EmptyState, cn } from "@doriface/ui";
import { SquareTerminal } from "lucide-react";

/** A terminal whose program had already ended when this view first attached: it says so, and closes from here. */
export function Ended({
  closeLabel,
  className,
  onClose,
}: {
  readonly closeLabel: string;
  readonly className?: string | undefined;
  readonly onClose: () => void;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col justify-center bg-card", className)}>
      <EmptyState
        icon={<SquareTerminal aria-hidden />}
        title="This session ended"
        description="Its program finished while this page wasn't showing it."
        actions={
          <Button variant="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
        }
      />
    </div>
  );
}
