import { expect, test } from "bun:test";
import { statusFrom } from "./status.ts";

const printed = (budget: unknown) => ({
  exit: 0,
  stderr: "",
  stdout: JSON.stringify({ sync: "ok", members: [], budget }),
});

test("the budget's halvedUntil is read as the host prints it: an ISO time while halved, null while whole", () => {
  const halved = statusFrom("a", printed({ waiting: 0, halvedUntil: "2026-11-04T12:30:00.000Z" })).halvedUntil;
  const whole = statusFrom("a", printed({ waiting: 0, halvedUntil: null })).halvedUntil;
  expect([halved, whole]).toEqual(["2026-11-04T12:30:00.000Z", null]);
});
