import { TooltipProvider } from "@doriface/ui";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { appearanceStore, applyAppearance } from "./appearance/appearance.ts";
import { connectionStore } from "./connection/store.ts";
import { removeServiceWorkers } from "./pwa/remove-service-workers.ts";
import { router } from "./router.tsx";

applyAppearance(appearanceStore.value);
connectionStore.start();
// The desktop shell serves the app from its own app: scheme; an offline cache there only reloads the window,
// so earlier desktop builds' workers and caches are removed instead.
if (location.protocol === "https:" || location.protocol === "http:") registerSW({ immediate: true });
else void removeServiceWorkers();
if (import.meta.env.DEV) void import("./dev-tools.ts");

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root");
createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
