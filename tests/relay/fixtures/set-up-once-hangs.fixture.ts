import { expect, test } from "bun:test";
import { setUpOnce } from "../support/set-up-once.ts";

setUpOnce(() => new Promise<void>(() => undefined), 1_000);

test("first", () => expect(true).toBe(true));
test("second", () => expect(true).toBe(true));
test("third", () => expect(true).toBe(true));
