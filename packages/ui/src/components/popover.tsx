import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { overlaySurface } from "./overlay.ts";

export interface PopoverProps {
  readonly trigger: ReactElement;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly className?: string;
  readonly defaultOpen?: boolean;
  /** Keeps the requested side even near a viewport edge; for static previews. */
  readonly fixedSide?: boolean;
}

export function Popover({
  trigger,
  title,
  children,
  side = "bottom",
  className,
  defaultOpen,
  fixedSide = false,
}: PopoverProps) {
  return (
    <BasePopover.Root {...(defaultOpen === undefined ? {} : { defaultOpen })}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          {...(fixedSide ? { collisionAvoidance: { side: "none" } } : {})}
          side={side}
          sideOffset={8}
        >
          <BasePopover.Popup className={cn(overlaySurface, "w-72 p-3", className)}>
            {title === undefined ? null : (
              <BasePopover.Title className="mb-1.5 text-sm font-semibold">{title}</BasePopover.Title>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
