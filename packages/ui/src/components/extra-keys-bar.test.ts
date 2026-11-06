import { expect, test } from "bun:test";
import { extraKeys } from "./extra-keys-bar.tsx";

test.each([false, true])("the key row puts a one-tap ^C right after Esc (command key: %p) (#673)", (command) => {
  const ids = extraKeys(command).map((entry) => entry.id);
  expect(ids.slice(-2)).toEqual(["esc", "interrupt"]);
  const interrupt = extraKeys(command).find((entry) => entry.id === "interrupt");
  expect(interrupt).toEqual({ id: "interrupt", label: "^C", name: "Control C" });
});
