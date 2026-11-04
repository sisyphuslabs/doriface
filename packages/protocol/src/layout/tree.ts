import { isJsonObject } from "../json.ts";
import {
  childrenOf,
  idOf,
  isContainer,
  typeOf,
  weightOf,
  withField,
  withoutField,
  type Axis,
  type Node,
} from "./node.ts";

export interface PaneRef {
  readonly id: string;
  /** The terminal's address in this machine's document, or null for a herdr-app panel. */
  readonly terminal: string | null;
  readonly mod: string | null;
}

export function terminalBlock(id: string, address: string): Node {
  return { content: { terminal: address }, id, type: "block" };
}

function paneOf(node: Node): PaneRef | null {
  const content = node["content"];
  if (typeOf(node) !== "block" || !isJsonObject(content)) return null;
  const terminal = typeof content["terminal"] === "string" ? content["terminal"] : null;
  const mod = typeof content["mod"] === "string" ? content["mod"] : null;
  return terminal === null && mod === null ? null : { id: idOf(node), terminal, mod };
}

export function panesOf(root: Node): readonly PaneRef[] {
  const pane = paneOf(root);
  return pane === null ? childrenOf(root).flatMap(panesOf) : [pane];
}

/** Child indices from `root` down to the node `id`; empty for the root itself, null when it is not in the tree. */
export function pathTo(root: Node, id: string): readonly number[] | null {
  if (idOf(root) === id) return [];
  const children = childrenOf(root);
  for (const [index, child] of children.entries()) {
    const below = pathTo(child, id);
    if (below !== null) return [index, ...below];
  }
  return null;
}

export function nodeAt(root: Node, path: readonly number[]): Node | null {
  let here: Node | undefined = root;
  for (const index of path) here = here === undefined ? undefined : childrenOf(here)[index];
  return here ?? null;
}

/** The tree with the node at `path` replaced; nodes off that path are the objects that were there. */
export function replaceAt(root: Node, path: readonly number[], replace: (node: Node) => Node): Node {
  const [index, ...rest] = path;
  if (index === undefined) return replace(root);
  const children = childrenOf(root);
  const child = children[index];
  if (child === undefined) return root;
  return { ...root, children: children.with(index, replaceAt(child, rest, replace)) };
}

/**
 * The tree without the pane `id`, herdr-app's `Node::remove`: its share goes to the neighbour it was split from (the
 * one before it, else the next), and a row or column left with one child gives way to that child, which takes its
 * slot size. Only containers on the way to the pane are touched. Null when the pane is not in the tree.
 */
export function removePane(root: Node, id: string): Node | null {
  const path = pathTo(root, id);
  const at = path?.at(-1);
  if (path === null || at === undefined) return null;
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(root, parentPath);
  const gone = nodeAt(root, path);
  if (parent === null || gone === null) return null;
  const kept = childrenOf(parent).filter((_, index) => index !== at);
  const heir = Math.max(0, at - 1);
  const goneWeight = weightOf(gone);
  const heirNode = kept[heir];
  const heirWeight = heirNode === undefined ? null : weightOf(heirNode);
  const inherited =
    typeOf(parent) !== "stack" && heirNode !== undefined && goneWeight !== null && heirWeight !== null
      ? kept.with(heir, withField(heirNode, "size", { weight: heirWeight + goneWeight }))
      : kept;
  // As herdr-app's remove_inner: a stack whose active child closed activates the one sliding into its place, or the last.
  const stackActive = (node: Node): Node => {
    if (typeOf(node) !== "stack" || node["active"] !== id) return node;
    const successor = inherited[at] ?? inherited.at(-1);
    return successor === undefined ? withoutField(node, "active") : { ...node, active: idOf(successor) };
  };
  let next = replaceAt(root, parentPath, (node) => stackActive({ ...node, children: inherited }));
  for (let depth = parentPath.length; depth > 0; depth -= 1) {
    const containerPath = path.slice(0, depth);
    const container = nodeAt(next, containerPath);
    if (container === null || (typeOf(container) !== "row" && typeOf(container) !== "column")) continue;
    const children = childrenOf(container);
    const only = children[0];
    if (children.length === 0) {
      next = replaceAt(next, containerPath.slice(0, -1), (node) => ({
        ...node,
        children: childrenOf(node).filter((_, index) => index !== containerPath.at(-1)),
      }));
    } else if (children.length === 1 && only !== undefined) {
      const slot = container["size"];
      next = replaceAt(next, containerPath, () =>
        slot === undefined ? withoutField(only, "size") : withField(only, "size", slot),
      );
    }
  }
  return next;
}

const halved = (node: Node, share: number): Node =>
  weightOf(node) === null ? node : withField(node, "size", { weight: share / 2 });

/**
 * Puts `block` after `target` along `axis`, herdr-app's `Node::split`: a parent that already runs along `axis` takes
 * it as a sibling and the two halve the target's share; otherwise the target is wrapped in a new container that keeps
 * the target's slot size. Null when the target is not a pane of this tree.
 */
export function splitPane(root: Node, target: string, axis: Axis, block: Node, containerId: string): Node | null {
  const path = pathTo(root, target);
  const at = path?.at(-1);
  if (path === null || at === undefined) return null;
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(root, parentPath);
  const old = nodeAt(root, path);
  if (parent === null || old === null || isContainer(old)) return null;
  if (typeOf(parent) === axis) {
    const share = weightOf(old) ?? 1;
    return replaceAt(root, parentPath, (node) => {
      const children = childrenOf(node);
      const next = [...children.slice(0, at), halved(old, share), halved(block, share), ...children.slice(at + 1)];
      return { ...node, children: next };
    });
  }
  const slot = old["size"];
  const wrapper: Node = {
    children: [withoutField(old, "size"), block],
    id: containerId,
    ...(slot === undefined ? {} : { size: slot }),
    type: axis,
  };
  return replaceAt(root, path, () => wrapper);
}
