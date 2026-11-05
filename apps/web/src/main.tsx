import { ToastProvider, ToastViewport, TooltipProvider } from "@doriface/ui";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { appearanceStore, startAppearance } from "./appearance/appearance.ts";
import { connectionStore } from "./connection/store.ts";
import {
  closeDesktopWindow,
  desktopBridge,
  installDesktopUpdate,
  onDesktopNavigate,
  onDesktopUpdateReady,
  onDesktopPairingLink,
  onDesktopRunAction,
  setDesktopBackground,
} from "./desktop/bridge.ts";
import { bootConnection } from "./desktop/local-host.ts";
import { captureInstallPrompt } from "./device/install.ts";
import { TerminalStyle } from "./ghostty/terminal-style.tsx";
import { PAIR_PATH, pairingLink } from "./pair/link-capture.ts";
import { removeServiceWorkers } from "./pwa/remove-service-workers.ts";
import { captureNotice, listenForDesktopNotices, listenForNotices } from "./push/notice-open.ts";
import { followConnection } from "./push/push-settings.ts";
import { runAction, setActionFallback, useKeymapDispatcher } from "./keys/dispatcher.ts";
import { reportMenuKeys } from "./keys/menu-keys.ts";
import { router } from "./router.tsx";
import { updateStore } from "./update/update-store.ts";
import { stepTerminalFont } from "./workspace/use-app-actions.ts";

startAppearance();
captureInstallPrompt();
// The desktop shell serves the app from its own app: scheme; an offline cache there only reloads the window,
// so earlier desktop builds' workers and caches are removed instead.
if (location.protocol === "https:" || location.protocol === "http:") {
  // A new worker waits until Reload to update (the sidebar's Settings dot says one does), so no page is swapped mid-use.
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () =>
      updateStore.set({
        apply: "reload",
        run: () => {
          // updateSW reloads only when the page had a worker as it registered; on a first visit it had none.
          navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
          void updateSW(true);
        },
      }),
  });
  // A tapped notification opens the app at /?notice=<id>, or reaches an open window as a message.
  captureNotice();
  listenForNotices(() => void router.navigate({ to: "/" }));
  followConnection();
} else void removeServiceWorkers();
void bootConnection(desktopBridge(), connectionStore);
/** Hands the page background to the desktop shell, which paints the window with it now and at the next launch. */
function paintWindow(): void {
  setDesktopBackground(getComputedStyle(document.documentElement).getPropertyValue("--background").trim());
}

onDesktopNavigate((path) => router.history.push(path));
onDesktopUpdateReady((version) => updateStore.set({ apply: "restart", version, run: () => installDesktopUpdate() }));
if (desktopBridge() !== null) {
  // The desktop app's Close Window leaves Cmd+W to the keymap; with no pane, tab or Settings to close, it closes the window.
  setActionFallback("tab.close", () => closeDesktopWindow());
  setActionFallback("pane.close", () => closeDesktopWindow());
  // The Shell menu runs the page's own actions and shows the page's own keys for them.
  onDesktopRunAction((action) => void runAction(action));
  // A clicked notification opens its pane in the workspace, from Settings too.
  listenForDesktopNotices(() => void router.navigate({ to: "/" }));
  reportMenuKeys();
  // Screens with no workspace (Settings, pairing) handle no text-size action, so the View menu's text-size items and
  // keys step the terminal text from here; the window itself is never zoomed (#388).
  for (const action of ["app.zoom_in", "app.zoom_out", "app.zoom_reset"]) {
    setActionFallback(action, () => stepTerminalFont(action));
  }
  paintWindow();
  appearanceStore.subscribe(paintWindow);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintWindow);
}
// Leaving the pair route forgets the link; coming back without one asks for a link or code again.
router.subscribe("onResolved", ({ toLocation }) => {
  if (toLocation.pathname !== PAIR_PATH) pairingLink.set(null);
});
// A doriface:// link or an in-app pairing link: the desktop shell hands over the fragment, never a URL to load.
onDesktopPairingLink((fragment) => {
  pairingLink.set(fragment);
  void router.navigate({ to: PAIR_PATH });
});
if (import.meta.env.DEV) void import("./dev-tools.ts");

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root");
function Keys() {
  useKeymapDispatcher();
  return null;
}

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <TerminalStyle />
        <Keys />
        <RouterProvider router={router} />
        <ToastViewport />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
