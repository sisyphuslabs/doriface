import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { connectionStore } from "./connection/store.ts";
import { ActionsPaused } from "./keys/dispatcher.ts";
import { keyboardIsIdle, mayTakeFocus } from "./terminal/may-take-focus.ts";
import { capturePairingLink } from "./pair/link-capture.ts";
import { PairRoute } from "./routes/pair-route.tsx";
import { SettingsRoute } from "./routes/settings-route.tsx";
import { WorkspaceRoute } from "./routes/workspace-route.tsx";

/**
 * The workspace stays mounted under Settings, hidden and inert, so leaving Settings shows its terminals as they were:
 * no pane attaches again and replays its history (seconds over the relay), the scroll stays where it was, and the
 * keyboard goes back to the focused pane's terminal, as it did when the workspace mounted again.
 */
function Root() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const settings = path === "/settings";
  useEffect(() => {
    if (settings) return;
    // Back at the workspace while a reconnect waits out its back-off: try now, not up to 10 s on (#403).
    connectionStore.retryNow();
    const input = document.querySelector<HTMLElement>('[data-focused="true"] [data-terminal] textarea');
    const terminal = input?.closest<HTMLElement>("[data-terminal]");
    if (input && terminal && mayTakeFocus(terminal) && keyboardIsIdle(terminal)) input.focus({ preventScroll: true });
  }, [settings]);
  if (path !== "/" && !settings) return <Outlet />;
  return (
    <>
      {settings ? (
        <div className="fixed inset-0 z-50 bg-background">
          <Outlet />
        </div>
      ) : null}
      {/* The view on screen is #root's first child: the desktop window waits for `#root > *` to paint, and the
          workspace kept under Settings is invisible, so it must not come first. */}
      <div className={settings ? "invisible contents" : "contents"} inert={settings}>
        <ActionsPaused.Provider value={settings}>
          <WorkspaceRoute />
        </ActionsPaused.Provider>
      </div>
    </>
  );
}

const root = createRootRoute({ component: Root });
const routes = [
  createRoute({ getParentRoute: () => root, path: "/", component: () => null }),
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
