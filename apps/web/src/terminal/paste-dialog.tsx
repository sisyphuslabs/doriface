import { Button, Dialog } from "@doriface/ui";
import type { PendingPaste } from "./use-behaviors.ts";

export interface PasteDialogProps {
  readonly paste: PendingPaste | null;
  readonly onPaste: (text: string) => void;
  readonly onCancel: () => void;
}

/** clipboard-paste-protection: several lines without bracketed paste would run as commands. */
export function PasteDialog({ paste, onPaste, onCancel }: PasteDialogProps) {
  const lines = paste === null ? 0 : paste.text.split(/\r?\n/).length;
  return (
    <Dialog
      open={paste !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Paste ${lines} lines?`}
      description="The program is not in bracketed paste mode, so each line may run as a command."
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => paste !== null && onPaste(paste.text)}>
            Paste
          </Button>
        </>
      }
    >
      <pre className="max-h-40 overflow-auto rounded-md bg-raised p-2 font-mono text-xs text-foreground">
        {paste?.text}
      </pre>
    </Dialog>
  );
}
