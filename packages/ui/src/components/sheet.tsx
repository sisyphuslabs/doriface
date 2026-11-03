import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { backdropClass } from "./overlay.ts";

const SIDE = {
  right:
    "inset-y-0 right-0 w-[min(24rem,100%)] border-l data-starting-style:translate-x-full data-ending-style:translate-x-full",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] data-starting-style:translate-y-full data-ending-style:translate-y-full",
} as const;

export interface SheetProps {
  readonly title: ReactNode;
  readonly side?: keyof typeof SIDE;
  readonly children: ReactNode;
  readonly trigger?: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** A panel that slides in from an edge; on phones the bottom sheet replaces popovers. */
/** The sheet's panel drawn in place, for static compositions. */
export function SheetPanel({ title, side = "bottom", children }: Pick<SheetProps, "title" | "side" | "children">) {
  return (
    <div
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        "flex flex-col border-border bg-popover text-popover-foreground shadow-overlay",
        side === "bottom" ? "rounded-t-xl border-t" : "border-l",
      )}
    >
      {side === "bottom" ? <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-input" /> : null}
      <p className="px-4 pt-3 pb-2 text-base font-semibold">{title}</p>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

export function Sheet({ title, side = "right", children, trigger, open, onOpenChange }: SheetProps) {
  return (
    <BaseDialog.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {trigger === undefined ? null : <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdropClass} />
        <BaseDialog.Popup
          className={cn(
            "fixed flex flex-col border-border bg-popover text-popover-foreground shadow-overlay outline-none",
            "transition-transform duration-(--duration-standard) ease-out motion-reduce:transition-opacity",
            SIDE[side],
          )}
        >
          {side === "bottom" ? <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-input" /> : null}
          <BaseDialog.Title className="px-4 pt-3 pb-2 text-base font-semibold">{title}</BaseDialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
