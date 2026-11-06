import { cn } from "@doriface/ui";
import { createContext, use, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSettingsClose } from "./use-close-settings.ts";

/** Settings is drawn in the dialog over the workspace (the desktop layout), not as the full-screen sheet of a phone. */
export const SettingsInDialog = createContext(false);

export const useSettingsInDialog = (): boolean => use(SettingsInDialog);

/**
 * Settings over the workspace on a wide screen: the terminals stay in view behind a dimmed backdrop and keep drawing
 * what their programs print, so a change to the theme, density or text size shows on them as it is made. A click on the
 * backdrop closes it, as Escape does. Focus moves into the dialog when it opens.
 */
export function SettingsDialog({ children }: { readonly children: ReactNode }) {
  const close = useSettingsClose();
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
  }, []);
  return (
    <SettingsInDialog value>
      {/* The modal level of the ui kit's own dialogs (z-50), so nothing in the workspace paints over it. */}
      <div aria-hidden className="fixed inset-0 z-50 bg-black/40" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        data-settings-dialog
        className={cn(
          // no-drag: in the desktop app a titlebar row under the panel would otherwise take its clicks to move the
          // window, since overlapping drag regions resolve in DOM order whatever paints on top.
          "z-50 [-webkit-app-region:no-drag]",
          "fixed inset-x-0 top-[6vh] mx-auto h-[min(88vh,48rem)] w-[min(calc(100vw-3rem),64rem)] overflow-hidden",
          "rounded-xl border border-border bg-background shadow-overlay outline-none",
        )}
      >
        {children}
      </div>
    </SettingsInDialog>
  );
}
