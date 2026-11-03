import { isJsonObject, type JsonObject, type JsonValue } from "../src/json.ts";

const COMPONENT_REF = "#/components/schemas/";

export type JsonImport = "JsonObject" | "JsonValue";

export interface RenderContext {
  readonly imports: Set<JsonImport>;
}

export class SchemaShapeError extends Error {
  override readonly name = "SchemaShapeError";
}

export function docComment(description: JsonValue | undefined): string {
  if (typeof description !== "string" || description.trim() === "") return "";
  const lines = description.replaceAll("*/", "*\\/").trim().split("\n");
  if (lines.length === 1) return `/** ${lines[0]} */\n`;
  return `/**\n${lines.map((line) => (line === "" ? " *" : ` * ${line}`)).join("\n")}\n */\n`;
}

export function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

export function renderType(node: JsonValue | undefined, ctx: RenderContext): string {
  if (node === undefined || node === true || (isJsonObject(node) && isUntyped(node))) {
    ctx.imports.add("JsonValue");
    return "JsonValue";
  }
  if (!isJsonObject(node)) throw new SchemaShapeError(`unsupported schema node ${JSON.stringify(node)}`);
  const ref = node["$ref"];
  if (typeof ref === "string") {
    if (ref.startsWith(COMPONENT_REF)) return ref.slice(COMPONENT_REF.length);
    ctx.imports.add("JsonObject");
    return "JsonObject";
  }
  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) return union(anyOf.map((member) => renderType(member, ctx)));
  const literals = node["enum"];
  if (Array.isArray(literals)) return union(literals.map((literal) => JSON.stringify(literal)));
  return union(typeNames(node).map((name) => renderNamedType(name, node, ctx)));
}

export function renderMembers(
  properties: readonly (readonly [string, JsonValue])[],
  required: ReadonlySet<string>,
  ctx: RenderContext,
): string {
  return properties
    .map(([name, schema]) => {
      const optional = required.has(name) ? "" : "?";
      const description = isJsonObject(schema) ? schema["description"] : undefined;
      return `${docComment(description)}readonly ${propertyKey(name)}${optional}: ${renderType(schema, ctx)};`;
    })
    .join("\n");
}

export function objectProperties(node: JsonObject): readonly (readonly [string, JsonValue])[] {
  const properties = node["properties"];
  return isJsonObject(properties) ? Object.entries(properties) : [];
}

export function requiredSet(node: JsonObject): ReadonlySet<string> {
  const required = node["required"];
  return new Set(Array.isArray(required) ? required.filter((name) => typeof name === "string") : []);
}

function isUntyped(node: JsonObject): boolean {
  return ["type", "$ref", "anyOf", "enum"].every((key) => node[key] === undefined);
}

function typeNames(node: JsonObject): readonly string[] {
  const type = node["type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((name) => typeof name === "string");
  throw new SchemaShapeError(`schema node without a usable type: ${JSON.stringify(node)}`);
}

function renderNamedType(name: string, node: JsonObject, ctx: RenderContext): string {
  switch (name) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return renderArray(node, ctx);
    case "object":
      return renderObject(node, ctx);
    default:
      throw new SchemaShapeError(`unsupported JSON Schema type ${name}`);
  }
}

function renderArray(node: JsonObject, ctx: RenderContext): string {
  const item = renderType(node["items"], ctx);
  const min = node["minItems"];
  const max = node["maxItems"];
  if (typeof min === "number" && min === max && min > 0 && min <= 4) {
    return `readonly [${Array.from({ length: min }, () => item).join(", ")}]`;
  }
  return item.includes("|") ? `readonly (${item})[]` : `readonly ${item}[]`;
}

function renderObject(node: JsonObject, ctx: RenderContext): string {
  const properties = objectProperties(node);
  if (properties.length > 0) return `{\n${renderMembers(properties, requiredSet(node), ctx)}\n}`;
  const additional = node["additionalProperties"];
  if (isJsonObject(additional)) return `{ readonly [key: string]: ${renderType(additional, ctx)} }`;
  ctx.imports.add("JsonObject");
  return "JsonObject";
}

function union(members: readonly string[]): string {
  return [...new Set(members)].join(" | ");
}
