import { describe, expect, test } from "bun:test";
import { meshFileJson, newMeshFile, parseMeshFile } from "./mesh-file.ts";

const record = { body: "body", sig: "sig" };

describe("the mesh file format guard", () => {
  test("a fresh file is written in the format a v2 reader accepts", () => {
    expect(meshFileJson(newMeshFile("mesh-1", [record], 1)).version).toBe(2);
  });

  test("this build reads both its own format and the next one", () => {
    for (const version of [2, 3]) {
      const file = parseMeshFile({ version, meshId: "m", generation: 1, self: { n: 1 }, records: [record] });
      expect(file.version).toBe(version);
    }
  });

  test("a format above what this build reads is refused before anything else runs", () => {
    expect(() => parseMeshFile({ version: 4, meshId: "m", generation: 1, self: { n: 1 }, records: [record] })).toThrow(
      "mesh.json: unsupported format",
    );
  });

  test("a format below what this build reads is refused too", () => {
    expect(() => parseMeshFile({ version: 1, meshId: "m", generation: 1, self: { n: 1 }, records: [record] })).toThrow(
      "mesh.json: unsupported format",
    );
  });

  test("a parsed file keeps its version, so a rewrite never silently downgrades it", () => {
    const parsed = parseMeshFile({ version: 3, meshId: "m", generation: 7, self: { n: 3 }, records: [record] });
    expect(meshFileJson(parsed).version).toBe(3);
  });

  test("a member written by a newer reader is not read back as something else", () => {
    const member = { signPub: "s", hostId: "h", noisePub: "n", name: "box", hcId: "c", kind: "client" };
    const file = parseMeshFile({
      version: 3,
      meshId: "m",
      generation: 1,
      self: { n: 1 },
      records: [record],
      index: { generation: 1, members: [member], overCap: [], revoked: [], superseded: [], named: [] },
    });
    expect(file.index?.members[0]).not.toHaveProperty("kind");
  });
});
