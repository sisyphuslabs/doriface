import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useId, useRef, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { backdropClass, overlaySurface } from "./overlay.ts";

export interface DialogProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** Buttons, trailing primary. */
  readonly actions?: ReactNode;
  readonly trigger?: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Where focus goes once it closes: an element, or true for the element that had focus when it opened. */
  readonly finalFocus?: () => HTMLElement | true;
  readonly className?: string;
  /** A statement to acknowledge (`alertdialog`): read out as it opens, and a click outside leaves it up. */
  readonly alert?: boolean;
}

/** Inside the viewport both ways: a 1rem margin each side, and a long question scrolls inside instead of off screen. */
const popupClass = "w-[min(28rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto p-5";
const titleClass = "text-lg font-semibold text-foreground";
const descriptionClass = "mt-1.5 text-base text-pretty text-muted-foreground";

function Body({ children, actions }: Pick<DialogProps, "children" | "actions">) {
  return (
    <>
      {children === undefined ? null : <div className="mt-4">{children}</div>}
      {actions === undefined ? null : <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>}
    </>
  );
}

/** A modal question. Title states the situation; the description is at most two short sentences. */
export function Dialog({
  title,
  description,
  children,
  actions,
  trigger,
  open,
  onOpenChange,
  finalFocus,
  className,
  alert = false,
}: DialogProps) {
  const state = { ...(open === undefined ? {} : { open }), ...(onOpenChange === undefined ? {} : { onOpenChange }) };
  const panel = useRef<HTMLDivElement>(null);
  // A question taller than the screen opens at its title: focus goes to the dialog itself, since focusing a button
  // below the fold would scroll the title out of view. A question that fits keeps Base UI's first focusable.
  const initialFocus = () => {
    const element = panel.current;
    return element !== null && element.scrollHeight > element.clientHeight ? element : true;
  };
  const popup = (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdropClass} />
      <BaseDialog.Popup
        ref={panel}
        initialFocus={initialFocus}
        {...(finalFocus === undefined ? {} : { finalFocus })}
        className={cn(
          overlaySurface,
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
          popupClass,
          className,
        )}
      >
        <BaseDialog.Title className={titleClass}>{title}</BaseDialog.Title>
        {description === undefined ? null : (
          <BaseDialog.Description className={descriptionClass}>{description}</BaseDialog.Description>
        )}
        <Body actions={actions}>{children}</Body>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
  if (alert) {
    return (
      <BaseAlertDialog.Root {...state}>
        {trigger === undefined ? null : <BaseAlertDialog.Trigger render={trigger} />}
        {popup}
      </BaseAlertDialog.Root>
    );
  }
  return (
    <BaseDialog.Root {...state}>
      {trigger === undefined ? null : <BaseDialog.Trigger render={trigger} />}
      {popup}
    </BaseDialog.Root>
  );
}

export type DialogPanelProps = Pick<DialogProps, "title" | "description" | "children" | "actions" | "className">;

/** The same panel drawn in place, for static compositions and previews of an open dialog. */
export function DialogPanel({ title, description, children, actions, className }: DialogPanelProps) {
  const id = useId();
  return (
    <div role="dialog" aria-labelledby={`${id}-title`} className={cn(overlaySurface, popupClass, className)}>
      <h2 id={`${id}-title`} className={titleClass}>
        {title}
      </h2>
      {description === undefined ? null : <p className={descriptionClass}>{description}</p>}
      <Body actions={actions}>{children}</Body>
    </div>
  );
}

export const DialogClose = BaseDialog.Close;
