import { isJsonObject, type JsonObject, type JsonValue } from "@doriface/protocol";

/**
 * A node of herdr-app's layout tree (`src/layout.rs` `Node`): a `block` shows a terminal or a herdr-app panel, `row`
 * and `column` lay their children out along one axis by weight, a `stack` shows one child. Nodes stay the JSON objects
 * that were read, so every field doriface does not use is written back as herdr-app wrote it.
 */
export type Node = JsonObject;
export type Axis = "row" | "column";

const TYPES: ReadonlySet<string> = new Set(["block", "row", "column", "stack"]);

export const typeOf = (node: Node): string => String(node["type"]);

/** An id like herdr-app's `fresh_id`: the kind's prefix and 128 random bits, so two screens never pick the same. */
export function freshId(prefix: "spc" | "tb" | "p" | "s"): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0"));
  return prefix + hex.join("");
}
export const idOf = (node: Node): string => (typeof node["id"] === "string" ? node["id"] : "");
export const isContainer = (node: Node): boolean => typeOf(node) !== "block";

export function childrenOf(node: Node): readonly Node[] {
  const children = node["children"];
  return Array.isArray(children) ? children.filter(isJsonObject) : [];
}

/** A row or column child's share: its weight, 1 when it has none, null when it is sized in pixels. */
export function weightOf(node: Node): number | null {
  const size = node["size"];
  if (!isJsonObject(size)) return 1;
  const weight = size["weight"];
  return typeof weight === "number" ? weight : null;
}

export function pixelsOf(node: Node): number | null {
  const size = node["size"];
  const px = isJsonObject(size) ? size["px"] : undefined;
  return typeof px === "number" ? px : null;
}

/** The node with one field set, keeping the key order herdr-app writes (sorted) when the field is new. */
export function withField(node: Node, key: string, value: JsonValue): Node {
  if (key in node) return { ...node, [key]: value };
  const entries = Object.entries(node);
  const at = entries.findIndex(([existing]) => existing > key);
  entries.splice(at === -1 ? entries.length : at, 0, [key, value]);
  return Object.fromEntries(entries);
}

export function withoutField(node: Node, key: string): Node {
  if (!(key in node)) return node;
  const { [key]: _gone, ...rest } = node;
  return rest;
}

/** Why herdr-app could not read this node, or null when it can: doriface never writes a tree it cannot read in full. */
export function problemIn(value: JsonValue): string | null {
  if (!isJsonObject(value)) return "a layout node that is not an object";
  const type = value["type"];
  if (type === undefined) return "a layout node without a type";
  if (typeof type !== "string" || !TYPES.has(type)) return `a layout node of type ${JSON.stringify(type)}`;
  if (value["id"] !== undefined && typeof value["id"] !== "string") return "a layout node whose id is not text";
  if (type === "block") return isJsonObject(value["content"]) ? null : "a block without content";
  const children = value["children"];
  if (!Array.isArray(children)) return `a ${type} without children`;
  for (const child of children) {
    const problem = problemIn(child);
    if (problem !== null) return problem;
  }
  return null;
}
