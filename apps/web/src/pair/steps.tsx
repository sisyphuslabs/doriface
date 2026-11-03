import { cn } from "@doriface/ui";
import { Check } from "lucide-react";

const STEPS = ["Host", "Pair", "Verify"] as const;

/** Host · Pair · Verify; the current step is bold and numbered, done steps carry a check. */
export function Steps({ current }: { readonly current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Pairing steps" className="flex items-center justify-center gap-2 text-sm">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={index === current ? "step" : undefined} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden className="h-px w-6 bg-border" /> : null}
          <span
            className={cn(
              "flex items-center gap-1.5",
              index === current ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {index < current ? <Check aria-label="done" className="size-3.5" /> : <span data-numeric>{index + 1}</span>}
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}
