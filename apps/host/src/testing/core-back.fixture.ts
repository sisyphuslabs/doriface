// Not a *.test.ts, so `bun test` never picks it up; core-attribution.hc.test.ts runs it by path. Its first test disposes
// its scratch session and then brings that session's core back, as a start still in flight after a host stopped would
// (#441); the second test starts no core at all.
import { expect, test } from "bun:test";
import { createHcSession } from "./hc-session.ts";

const STATUS = new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"server.status"}\n');

test("brings its session's core back after disposing it", async () => {
  const session = createHcSession("core-back");
  await session.dispose();
  const control = session.connect();
  await control.write(STATUS);
  await control.reader.line();
  control.end();
  await control.exited;
});

test("a later test that starts no core", () => {
  expect(true).toBe(true);
});
