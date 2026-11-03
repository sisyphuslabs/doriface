import { expect, test } from "bun:test";
import { setUpOnce } from "../support/set-up-once.ts";

setUpOnce((): Promise<void> => {
  console.log("set-up ran");
  throw new Error("set-up threw on purpose");
}, 1_000);

test("first", () => expect(true).toBe(true));
test("second", () => expect(true).toBe(true));
