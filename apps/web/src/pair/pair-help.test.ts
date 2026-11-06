import { describe, expect, test } from "bun:test";
import { PAIR_STEP_DESCRIPTION } from "./pair-help.ts";

describe("what the pair step says it takes", () => {
  test("names the two ways the step accepts a host: the pairing link and its 8-character code", () => {
    expect(PAIR_STEP_DESCRIPTION).toContain("pairing link");
    expect(PAIR_STEP_DESCRIPTION).toContain("8-character code");
  });

  test("promises no camera, because no flow in the app scans a code", () => {
    expect(PAIR_STEP_DESCRIPTION).not.toMatch(/camera|scan/i);
  });
});
