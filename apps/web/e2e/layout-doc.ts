// The herdr-app layout document on the e2e core, written the way herdr-app 0.1.12 writes it: keys sorted, `type` on
// every node, a tab's root a row whose id is the tab's.
import type { Locator, Page } from "@playwright/test";
import { setCoreDoc } from "./core-doc.ts";

export const LAYOUT_DOC = "herdr-app";

export type Tree =
  | { readonly pane: string; readonly terminal: string; readonly weight?: number }
  | { readonly id: string; readonly axis: "row" | "column"; readonly children: readonly Tree[]; readonly weight?: number };

const sized = (node: Record<string, unknown>, weight: number | undefined): Record<string, unknown> =>
  weight === undefined ? node : { ...node, size: { weight } };

export function node(tree: Tree): Record<string, unknown> {
  if ("pane" in tree) {
    return sized({ content: { terminal: tree.terminal }, id: tree.pane, type: "block" }, tree.weight);
  }
  return sized({ children: tree.children.map(node), id: tree.id, type: tree.axis }, tree.weight);
}

export interface SeedTab {
  readonly id: string;
  readonly name?: string;
  readonly root: readonly Tree[];
}

export function seedLayout(tabs: readonly SeedTab[], folder = "/tmp"): void {
  setCoreDoc(LAYOUT_DOC, {
    spaces: [
      {
        folder,
        id: "spc-e2e",
        name: "",
        tabs: tabs.map((tab) => ({
          id: tab.id,
          name: tab.name ?? "",
          root: { children: tab.root.map(node), id: tab.id, type: "row" },
        })),
      },
    ],
  });
}

export function clearLayout(): void {
  setCoreDoc(LAYOUT_DOC, null);
}

export const paneOf = (page: Page, address: string): Locator =>
  page.locator("section", { has: page.locator(`[data-terminal="${address}"]`) });

export interface Fraction {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A pane's box as fractions of the selected tab's panel, so the check holds at any window size. */
export async function fractionOf(page: Page, address: string): Promise<Fraction> {
  const panel = page.locator('[role="tabpanel"]:visible');
  const [outer, inner] = [await panel.boundingBox(), await paneOf(page, address).boundingBox()];
  if (outer === null || inner === null) throw new Error(`no box for ${address} or its tab panel`);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    x: round((inner.x - outer.x) / outer.width),
    y: round((inner.y - outer.y) / outer.height),
    w: round(inner.width / outer.width),
    h: round(inner.height / outer.height),
  };
}
