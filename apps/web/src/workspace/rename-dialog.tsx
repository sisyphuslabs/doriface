import { Button, Dialog, Field, Input } from "@doriface/ui";
import { useId, useState } from "react";

export interface RenameDialogProps {
  readonly title: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly description?: string;
  readonly onRename: (name: string) => void;
  readonly onCancel: () => void;
}

export function RenameDialog({
  title,
  busy,
  error,
  description = "Every device shows the new name. Leave it empty to show the program's own title again.",
  onRename,
  onCancel,
}: RenameDialogProps) {
  const id = useId();
  const [name, setName] = useState(title);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Rename ${title}`}
      description={description}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRename(name);
        }}
        className="flex flex-col gap-5"
      >
        <Field label="Name" htmlFor={id} {...(error === null ? {} : { error })}>
          <Input id={id} value={name} maxLength={80} autoFocus onValueChange={(next: string) => setName(next)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
