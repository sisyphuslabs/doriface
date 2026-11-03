import { describe, expect, test } from "bun:test";
import { generateApi, OUTPUT_PATH, SCHEMA_PATH } from "../scripts/gen-api.ts";
import { SchemaShapeError } from "../scripts/schema-to-ts.ts";

const schemaWith = (schemas: object, methods: readonly object[] = []) =>
  JSON.stringify({ info: { version: "9.9.9" }, components: { schemas }, methods });

describe("hc-api codegen", () => {
  test("the committed hc-api.ts matches the vendored schema", async () => {
    const generated = await generateApi(await Bun.file(SCHEMA_PATH).text());
    expect(await Bun.file(OUTPUT_PATH).text()).toBe(generated);
  });

  test("maps JSON Schema shapes to readonly TypeScript", async () => {
    const source = await generateApi(
      schemaWith(
        {
          Pair: {
            type: "object",
            required: ["cell"],
            properties: {
              cell: { type: ["array", "null"], items: { type: "integer" }, minItems: 2, maxItems: 2 },
              mode: { enum: ["idle", "working"], type: "string" },
              tags: { type: "object", additionalProperties: { type: "string" } },
              value: true,
            },
          },
        },
        [
          {
            name: "pair.get",
            params: [{ name: "id", required: true, schema: { type: "string" } }],
            result: { schema: { $ref: "#/components/schemas/Pair" } },
          },
        ],
      ),
    );
    expect(source).toContain("readonly cell: readonly [number, number] | null;");
    expect(source).toContain('readonly mode?: "idle" | "working";');
    expect(source).toContain("readonly tags?: { readonly [key: string]: string };");
    expect(source).toContain("readonly value?: JsonValue;");
    expect(source).toContain("export interface PairGetParams {\n  readonly id: string;\n}");
    expect(source).toContain('readonly "pair.get": { readonly params: PairGetParams; readonly result: Pair };');
  });

  test("refuses schema types it cannot express", async () => {
    await expect(generateApi(schemaWith({ Odd: { type: "tuple" } }))).rejects.toThrow(SchemaShapeError);
    await expect(generateApi(schemaWith({ Remote: { $ref: "https://example.com/x.json" } }))).rejects.toThrow(
      SchemaShapeError,
    );
  });
});
