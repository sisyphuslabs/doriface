import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { PairRoute } from "./routes/pair-route.tsx";
import { SettingsRoute } from "./routes/settings-route.tsx";
import { WorkspaceRoute } from "./routes/workspace-route.tsx";

const root = createRootRoute({ component: Outlet });
const routes = [
  createRoute({ getParentRoute: () => root, path: "/", component: WorkspaceRoute }),
  createRoute({ getParentRoute: () => root, path: "/pair", component: PairRoute }),
  createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsRoute }),
];

export const router = createRouter({ routeTree: root.addChildren(routes) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
