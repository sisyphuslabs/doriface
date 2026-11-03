import { TooltipProvider } from "@doriface/ui";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { appearanceStore, applyAppearance } from "./appearance/appearance.ts";
import { connectionStore } from "./connection/store.ts";
import { desktopBridge, onDesktopOpenSettings } from "./desktop/bridge.ts";
import { bootConnection } from "./desktop/local-host.ts";
import { TerminalStyle } from "./ghostty/terminal-style.tsx";
import { removeServiceWorkers } from "./pwa/remove-service-workers.ts";
import { useKeymapDispatcher } from "./keys/dispatcher.ts";
import { router } from "./router.tsx";

applyAppearance(appearanceStore.value);
// The desktop shell serves the app from its own app: scheme; an offline cache there only reloads the window,
// so earlier desktop builds' workers and caches are removed instead.
if (location.protocol === "https:" || location.protocol === "http:") registerSW({ immediate: true });
else void removeServiceWorkers();
void bootConnection(desktopBridge(), connectionStore);
onDesktopOpenSettings(() => void router.navigate({ to: "/settings" }));
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
      <TerminalStyle />
      <Keys />
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
