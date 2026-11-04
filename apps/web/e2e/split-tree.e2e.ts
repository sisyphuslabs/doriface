import { startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { clearLayout, fractionOf, paneOf, seedLayout, type Fraction } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

const shells: string[] = [];
test.afterEach(() => {
  clearLayout();
  for (const address of shells.splice(0)) hcOn("host", ["kill", address]);
});

test("a tab shows its herdr-app split tree, four levels of rows and columns, and keeps it across a reload", async ({
  page,
}) => {
  const shell = (name: string): string => {
    const address = startShell("host", `tree-${name}`);
    shells.push(address);
    return address;
  };
  const [t1, t2, t3, t4, t5, t6] = [shell("1"), shell("2"), shell("3"), shell("4"), shell("5"), shell("6")] as const;
  // Right of one, then down from two, right of three, down from four: what herdr-app writes for ⌘D ⌘⇧D ⌘D ⌘⇧D.
  seedLayout([
    {
      id: "tb-tree",
      root: [
        { pane: "p1", terminal: t1, weight: 0.5 },
        {
          id: "s-col",
          axis: "column",
          weight: 0.5,
          children: [
            { pane: "p2", terminal: t2 },
            {
              id: "s-row",
              axis: "row",
              children: [
                { pane: "p3", terminal: t3 },
                {
                  id: "s-deep",
                  axis: "column",
                  children: [
                    { pane: "p4", terminal: t4 },
                    { pane: "p5", terminal: t5 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { id: "tb-other", name: "build", root: [{ pane: "p6", terminal: t6 }] },
  ]);
  const expected: Readonly<Record<string, Fraction>> = {
    [t1]: { x: 0, y: 0, w: 0.5, h: 1 },
    [t2]: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    [t3]: { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
    [t4]: { x: 0.75, y: 0.5, w: 0.25, h: 0.25 },
    [t5]: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 },
  };
  const near = (actual: Fraction, want: Fraction): boolean =>
    (["x", "y", "w", "h"] as const).every((key) => Math.abs(actual[key] - want[key]) <= 0.02);
  const shownAsSeeded = async (): Promise<string[]> => {
    const off: string[] = [];
    for (const [address, want] of Object.entries(expected)) {
      const actual = await fractionOf(page, address).catch(() => null);
      if (actual === null || !near(actual, want)) off.push(`${address} ${JSON.stringify(actual)}`);
    }
    return off;
  };

  for (const load of ["first load", "reload"]) {
    if (load === "reload") await page.reload();
    else await page.goto("/");
    const strip = page.getByRole("tablist", { name: "Tabs" });
    await expect(strip.getByRole("tab")).toHaveCount(2, { timeout: 20_000 });
    await expect(strip.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect.poll(shownAsSeeded, { timeout: 20_000 }).toEqual([]);
    await expect(paneOf(page, t6)).toBeHidden();
    for (const address of [t1, t2, t3, t4, t5]) await expect(paneOf(page, address)).toContainText("$");
  }
});
