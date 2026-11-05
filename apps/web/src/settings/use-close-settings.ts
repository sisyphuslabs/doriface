import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useActionHandler } from "../keys/dispatcher.ts";

/** Whatever owns the keyboard while it is open: dialogs, menus, lists and a shortcut being recorded. */
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-captures-keys]';
const TEXT_INPUTS: ReadonlySet<string> = new Set(["text", "search", "url", "email", "number", "password", "tel"]);

const layerOpen = (): boolean => document.querySelector(LAYERS) !== null;

/**
 * Whether a focused text field takes this Escape instead of Settings: a search with text clears itself (the browser's
 * own Escape action, so the key is left alone), and any other text field gives up focus first.
 */
function fieldTakesEscape(event: KeyboardEvent): boolean {
  const target = event.target;
  const field =
    target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type));
  if (!field) return false;
  if (target instanceof HTMLInputElement && target.type === "search") return target.value !== "";
  event.preventDefault();
  target.blur();
  return true;
}

/**
 * Leaves Settings for the view it was opened from. Escape closes it unless a layer above or a focused text field takes
 * the key first. The keymap's settings toggle and close-tab shortcuts close it too; while a layer is open they are taken
 * and do nothing, so they neither close Settings under a dialog or recording nor fall through to the window.
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
      if (layerOpen() || fieldTakesEscape(event)) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [close]);

  useActionHandler("app", (action) => {
    if (action !== "app.settings" && action !== "tab.close" && action !== "pane.close") return false;
    if (!layerOpen()) close();
    return true;
  });
  return close;
}
