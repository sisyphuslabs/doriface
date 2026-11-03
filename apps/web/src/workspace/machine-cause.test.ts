import { expect, test } from "bun:test";
import { REFUSALS } from "../../../host/src/connect/dial.ts";
import { machineCause } from "./machine-cause.ts";

const unreachable = (why: string) => machineCause({ name: "box", state: "unreachable", why });
const fallback = unreachable("")?.detail;

test("every refusal doriface-host prints reads as its own cause, never the generic one", () => {
  for (const [code, message] of Object.entries(REFUSALS)) {
    const why = `cannot reach doriface-host connect h1: ${message("h1")} (${code})`;
    expect({ code, detail: unreachable(why)?.detail }).not.toEqual({ code, detail: fallback });
  }
});
