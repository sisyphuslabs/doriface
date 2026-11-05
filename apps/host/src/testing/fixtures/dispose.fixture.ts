import { expect, test } from "bun:test";
import { createHcSession } from "../hc-session.ts";

// Run on its own by hc-session-teardown.hc.test.ts: one scratch session made and disposed, nothing left behind.
test("a scratch session made and disposed", async () => {
  const session = createHcSession("teardown");
  await session.dispose();
  expect(session.name.startsWith("teardown-")).toBe(true);
});
