import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, TooltipProvider } from "../src/index.ts";
import { ROUTES, type RouteId } from "./routes.tsx";

function readRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return ROUTES.find((route) => route.id === id)?.id ?? "primitives";
}

function applyTheme(): void {
  const theme = new URLSearchParams(window.location.search).get("theme");
  if (theme === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset["theme"] = theme;
}

function App() {
  const [route, setRoute] = useState<RouteId>(readRoute);
  useEffect(() => {
    applyTheme();
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const Screen = ROUTES.find((entry) => entry.id === route)?.render ?? ROUTES[0]?.render;
  return Screen === undefined ? null : <Screen />;
}

const root = document.getElementById("root");
if (root !== null) {
  applyTheme();
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delay={400}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </StrictMode>,
  );
}
