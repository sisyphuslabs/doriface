import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useActionHandler } from "../keys/dispatcher.ts";

/** Whatever owns Escape while it is open: dialogs, menus, lists and a shortcut being recorded. */
const ESCAPE_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-captures-keys]';

/**
 * Leaves Settings for the view it was opened from. Escape closes it unless a layer above owns the key, and the
 * keymap's settings toggle and close-tab shortcuts close it too, so the key never falls through to the window.
 */
export function useCloseSettings(): () => void {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const close = useCallback((): void => {
    if (canGoBack) router.history.back();
    else void navigate({ to: "/", replace: true });
  }, [canGoBack, router, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      if (document.querySelector(ESCAPE_LAYERS) !== null) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [close]);

  useActionHandler("app", (action) => {
    if (action !== "app.settings" && action !== "tab.close") return false;
    close();
    return true;
  });
  return close;
}
