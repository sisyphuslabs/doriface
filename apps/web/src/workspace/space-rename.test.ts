import { describe, expect, test } from "bun:test";
import { HcRpcError, type Terminal, type TerminalLabelParams } from "@doriface/protocol";
import { spaceId, toSpaces } from "./model.ts";
import { renameSpace, spaceNameProblem } from "./space-rename.ts";

const terminal = (fields: Partial<Terminal>): Terminal => ({
  address: "t1",
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/doriface",
  labels: {},
  screen: "exact",
  state: "live",
  ...fields,
});

const API_ONE = terminal({ address: "t1", labels: { space: "api" } });
const API_TWO = terminal({ address: "t2", cwd: "/work/elsewhere", labels: { space: "api" } });
const API_ENDED = terminal({ address: "t3", labels: { space: "api" }, state: "finished" });
const WEB = terminal({ address: "t4", cwd: "/home/me/web" });
const REMOTE_WEB = terminal({ address: "box/t1", cwd: "/srv/web" });
const ALL = [API_ONE, API_TWO, API_ENDED, WEB, REMOTE_WEB];
const API = spaceId(API_ONE);

/** hc's terminal.label, applied to `terminals` as hc would, refusing the addresses in `refuse` with that kind. */
function hcLabels(terminals: readonly Terminal[], refuse: Readonly<Record<string, string>> = {}) {
  let state = [...terminals];
  const label = (params: TerminalLabelParams): Promise<unknown> => {
    const kind = refuse[params.terminal];
    if (kind !== undefined) return Promise.reject(new HcRpcError({ code: -32000, message: kind, data: { kind } }));
    state = state.map((each) =>
      each.address === params.terminal ? { ...each, labels: { ...each.labels, ...params.labels } } : each,
    );
    return Promise.resolve({});
  };
  return { label, read: () => state };
}

describe("space names", () => {
  test.each([[""], ["   "], ["\t\n"]])("a blank name (%j) is refused", (name) => {
    expect(spaceNameProblem(ALL, API, name)).toBe("A space needs a name.");
  });

  test("another space's name on the same machine is refused; the same name on another machine is not", () => {
    expect(spaceNameProblem(ALL, API, " web ")).toBe("Another space on this machine is already called web.");
    expect(spaceNameProblem(ALL, spaceId(REMOTE_WEB), "api")).toBeNull();
  });

  test("the space's own name and a fresh name are accepted", () => {
    expect(spaceNameProblem(ALL, API, "api")).toBeNull();
    expect(spaceNameProblem(ALL, API, "backend")).toBeNull();
  });

  test("a space with no running terminal left cannot be renamed", () => {
    expect(spaceNameProblem([API_ENDED, WEB], API, "backend")).toBe(
      "This space has no running terminal left to rename.",
    );
  });
});

describe("renaming a space", () => {
  test("every running terminal of the space is relabelled in hc, so every client lists the space under its new name", async () => {
    const hc = hcLabels(ALL);
    const renamed = await renameSpace(hc, ALL, API, "  backend ");
    expect(renamed).toBe("local/backend");
    expect(toSpaces(hc.read()).map((space) => [space.id, space.name, space.tabs])).toEqual([
      ["local/backend", "backend", 2],
      ["local/web", "web", 1],
      ["machine:box/web", "web", 1],
    ]);
    expect(hc.read().find((each) => each.address === "t3")?.labels).toEqual({ space: "api" });
  });

  test("a space named after its folder gets the label too, on its own machine only", async () => {
    const hc = hcLabels(ALL);
    expect(await renameSpace(hc, ALL, spaceId(REMOTE_WEB), "site")).toBe("machine:box/site");
    expect(hc.read().find((each) => each.address === "box/t1")?.labels).toEqual({ space: "site" });
    expect(hc.read().find((each) => each.address === "t4")?.labels).toEqual({});
  });

  test("a terminal removed meanwhile is no failure; any other refusal fails the rename after the rest are written", async () => {
    await expect(renameSpace(hcLabels(ALL, { t2: "not_found" }), ALL, API, "backend")).resolves.toBe("local/backend");
    const hc = hcLabels(ALL, { t2: "unreachable" });
    await expect(renameSpace(hc, ALL, API, "backend")).rejects.toThrow("unreachable");
    expect(hc.read().find((each) => each.address === "t1")?.labels).toEqual({ space: "backend" });
  });
});
