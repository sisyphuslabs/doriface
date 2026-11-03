import { Button, Dialog } from "@doriface/ui";

const STEPS = [
  { where: "On the machine to add, start a pairing. It prints a link and a code.", command: "doriface-host pair" },
  {
    where: "On this machine, pair with it using that link.",
    command: "doriface-host connect '<link>' < /dev/null",
  },
  {
    where: "Still on this machine, add it under a name. Its terminals then show here.",
    command: "hc machine add --via 'doriface-host connect <hostId>' --name <name>",
  },
] as const;

/** How to add a machine: the three commands, in order, where to run each. */
export function AddMachineDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add a machine"
      description="Both machines run doriface-host. The link travels end-to-end encrypted through the relay, so neither needs ssh or an open port."
      className="w-[min(34rem,calc(100%-2rem))]"
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ol className="flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step.command} className="flex flex-col gap-1.5">
            <p className="text-sm text-foreground">
              <span data-numeric className="mr-1.5 text-muted-foreground">
                {index + 1}.
              </span>
              {step.where}
            </p>
            <code className="block rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-sm break-all whitespace-pre-wrap text-foreground select-all">
              {step.command}
            </code>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
