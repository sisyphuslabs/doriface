import { expect, test } from "bun:test";
import { createHcSession } from "../hc-session.ts";

// Run on its own by hc-session-teardown.hc.test.ts: a scratch core started again after dispose (as a dialer's reconnect
// does) and left serving, for the leftover-core guard to find, stop and report.
test("a scratch core started again after dispose and left running", async () => {
  const session = createHcSession("teardown-restart");
  await session.dispose();
  const again = session.connect();
  await again.write(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"server.status"}\n'));
  await again.reader.line();
  again.end();
  await again.exited;
  console.log(`LEFT ${session.env["HC_SOCKET"] ?? ""}`);
  expect(session.name.startsWith("teardown-restart-")).toBe(true);
});
