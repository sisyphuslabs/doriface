import { expect, test } from "bun:test";
import { docEdit } from "./use-layout-docs.ts";

const noChange = (): null => null;

test("a machine with no live document refuses an edit with why, instead of passing it off as one that no longer applies", async () => {
  await expect(docEdit(undefined)(noChange)).rejects.toThrow("the machine is not connected");
  const changes: unknown[] = [];
  const live = { edit: (change: unknown) => (changes.push(change), Promise.resolve(true)) };
  expect(await docEdit(live)(noChange)).toBe(true);
  expect(changes).toEqual([noChange]);
});
