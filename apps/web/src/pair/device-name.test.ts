import { expect, test } from "bun:test";
import { deviceName } from "./device-name.ts";

test.each([
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Chrome on macOS"],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1",
    "Safari on iOS",
  ],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0", "Edge on Windows"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"],
  ["curl/8.0", "Browser"],
])("%s is %s", (userAgent, name) => {
  expect(deviceName(userAgent)).toBe(name);
});
