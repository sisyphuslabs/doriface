import { Button, EmptyState } from "@doriface/ui";
import { SquareTerminal } from "lucide-react";

export function NoTerminal({ onNew }: { readonly onNew: () => void }) {
  return (
    <EmptyState
      className="flex-1"
      icon={<SquareTerminal aria-hidden />}
      title="No terminal open"
      description="Start a shell on this host, or pick an agent or a space."
      actions={
        <Button variant="primary" onClick={onNew}>
          New terminal
        </Button>
      }
    />
  );
}
