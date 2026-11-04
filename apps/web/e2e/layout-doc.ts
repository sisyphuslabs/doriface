// The herdr-app layout document on the e2e core, written the way herdr-app 0.1.12 writes it: keys sorted, `type` on
// every node, a tab's root a row whose id is the tab's.
import type { Locator, Page } from "@playwright/test";
import { getCoreDoc, setCoreDoc } from "./core-doc.ts";
import { LAYOUT_MACHINE_SPEC } from "./layout-seed.ts";
import { MACHINE_NAME } from "./machine.ts";

export const LAYOUT_DOC = "herdr-app";

export type Tree =
  | { readonly pane: string; readonly terminal: string; readonly weight?: number }
  | {
      readonly id: string;
      readonly axis: "row" | "column";
      readonly children: readonly Tree[];
      readonly weight?: number;
    };

const sized = (node: Record<string, unknown>, weight: number | undefined): Record<string, unknown> =>
  weight === undefined ? node : { ...node, size: { weight } };

export function treeNode(tree: Tree): Record<string, unknown> {
  if ("pane" in tree) {
    return sized({ content: { terminal: tree.terminal }, id: tree.pane, type: "block" }, tree.weight);
  }
  return sized({ children: tree.children.map(treeNode), id: tree.id, type: tree.axis }, tree.weight);
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
          root: { children: tab.root.map(treeNode), id: tab.id, type: "row" },
        })),
      },
    ],
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** A saved tree as `id@weight(children)`, so a spec reads the shape and the sizes it keeps in one line. */
function outline(node: unknown): string {
  if (!isRecord(node)) return "?";
  const size = node["size"];
  const weight = isRecord(size) && typeof size["weight"] === "number" ? `@${size["weight"]}` : "";
  const children = listOf(node["children"]);
  return `${String(node["id"])}${weight}${children.length === 0 ? "" : `(${children.map(outline).join(",")})`}`;
}

/** The saved tab's tree in the core's layout document, as `outline` writes it, or null when no tab has that id. */
export function savedTab(id: string): string | null {
  const doc = getCoreDoc(LAYOUT_DOC);
  const spaces = isRecord(doc) ? listOf(doc["spaces"]) : [];
  const tab = spaces
    .flatMap((space) => (isRecord(space) ? listOf(space["tabs"]) : []))
    .find((each) => isRecord(each) && each["id"] === id);
  return isRecord(tab) ? outline(tab["root"]) : null;
}

/** Renames a saved tab as another device would: once the page shows the name, it has read every earlier write. */
export function renameTab(id: string, name: string): void {
  const doc = getCoreDoc(LAYOUT_DOC);
  if (!isRecord(doc)) throw new Error("no layout document to rename a tab in");
  const renamed = (tab: unknown): unknown =>
    isRecord(tab) && tab["id"] === id ? Object.assign({}, tab, { name }) : tab;
  const inSpace = (space: unknown): unknown =>
    isRecord(space) ? Object.assign({}, space, { tabs: listOf(space["tabs"]).map(renamed) }) : space;
  setCoreDoc(LAYOUT_DOC, { ...doc, spaces: listOf(doc["spaces"]).map(inSpace) });
}

export function clearLayout(): void {
  setCoreDoc(LAYOUT_DOC, null);
}

/**
 * Every spec starts with no tabs saved, on both e2e cores and on the added machine, as each started before the layout lived
 * in the core. A machine that is not connected shows a fresh page no layout, so there is nothing to clear on it.
 */
export function clearLayouts(): void {
  clearLayout();
  setCoreDoc(LAYOUT_DOC, null, undefined, "layout");
  clearOn(MACHINE_NAME, "host");
  clearOn(LAYOUT_MACHINE_SPEC.name, "layout");
}

function clearOn(machine: string, core: "host" | "layout"): void {
  try {
    setCoreDoc(LAYOUT_DOC, null, machine, core);
  } catch (error) {
    if (!/"kind":"(unavailable|machine_unknown|needs_login)"/.test(String(error))) throw error;
  }
}

export const paneOf = (page: Page, address: string): Locator =>
  page.locator("section", { has: page.locator(`[data-terminal="${address}"]`) });

const round = (value: number): number => Math.round(value * 100) / 100;

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
  return {
    x: round((inner.x - outer.x) / outer.width),
    y: round((inner.y - outer.y) / outer.height),
    w: round(inner.width / outer.width),
    h: round(inner.height / outer.height),
  };
}
