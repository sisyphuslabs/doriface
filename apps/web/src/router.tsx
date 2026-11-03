import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { capturePairingLink } from "./pair/link-capture.ts";
import { PairRoute } from "./routes/pair-route.tsx";
import { SettingsRoute } from "./routes/settings-route.tsx";
import { WorkspaceRoute } from "./routes/workspace-route.tsx";

const root = createRootRoute({ component: Outlet });
const routes = [
  createRoute({ getParentRoute: () => root, path: "/", component: WorkspaceRoute }),
  createRoute({ getParentRoute: () => root, path: "/pair", component: PairRoute }),
  createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsRoute }),
];

// The router reads the URL once, here, and main.tsx renders and dials out only after this module has run: a pairing
// link leaves the address bar and the history first. A link opened later on the same page arrives as a hashchange.
capturePairingLink();
addEventListener("hashchange", () => capturePairingLink());

export const router = createRouter({ routeTree: root.addChildren(routes) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
