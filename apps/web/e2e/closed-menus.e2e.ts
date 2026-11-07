import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

interface PointMenus {
  readonly closed: number;
  readonly closedWithMenu: number;
}

/**
 * Walks every React root the page committed (collected by the DevTools hook below) and finds each PointMenu by its own
 * props, which survive the production build's minification. A closed one is a fiber whose `at` is null; holding a menu
 * means it rendered anything under itself.
 */
const pointMenus = (page: Page): Promise<PointMenus> =>
  page.evaluate(() => {
    interface Fiber {
      readonly child: Fiber | null;
      readonly sibling: Fiber | null;
      readonly memoizedProps: unknown;
    }
    const roots = Reflect.get(window, "__dorifaceFiberRoots") as Set<{ readonly current: Fiber }> | undefined;
    if (roots === undefined) throw new Error("the React DevTools hook never saw a root");
    let closed = 0;
    let closedWithMenu = 0;
    for (const root of roots) {
      const stack: Fiber[] = [root.current];
      while (stack.length > 0) {
        const fiber = stack.pop();
        if (fiber === undefined) break;
        const props = fiber.memoizedProps;
        const pointMenu =
          typeof props === "object" &&
          props !== null &&
          "at" in props &&
          "label" in props &&
          typeof Reflect.get(props, "onClose") === "function";
        if (pointMenu && Reflect.get(props, "at") === null) {
          closed += 1;
          if (fiber.child !== null) closedWithMenu += 1;
        }
        if (fiber.sibling !== null) stack.push(fiber.sibling);
        if (fiber.child !== null) stack.push(fiber.child);
      }
    }
    return { closed, closedWithMenu };
  });

test("a closed point menu mounts nothing, so a pane's link and selection menus cost no render while closed (#842)", async ({
  page,
}) => {
  // A stand-in for React DevTools: React hands every committed root to it, which is how the spec reads the fibers.
  await page.addInitScript(() => {
    const roots = new Set<unknown>();
    Reflect.set(window, "__dorifaceFiberRoots", roots);
    Reflect.set(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => undefined,
      onScheduleFiberRoot: () => undefined,
      onCommitFiberRoot: (_renderer: number, root: unknown) => roots.add(root),
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
    });
  });
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await expect(terminal).toHaveAttribute("data-ready", "true");
  // Each terminal pane draws two: the menu a tapped link opens and the one a held touch's selection opens (#680).
  await expect.poll(async () => (await pointMenus(page)).closed).toBeGreaterThanOrEqual(2);
  // Closed, a Base UI menu root still runs its floating, dismiss and list-navigation hooks on each render of its pane:
  // at 50 panes streaming output that was the render bench's long-task regression since v0.1.2.
  expect((await pointMenus(page)).closedWithMenu).toBe(0);
});
