import { describe, expect, test } from "bun:test";
import { pushSupport, type SupportScope } from "./push-support.ts";

const browser: SupportScope = {
  protocol: "https:",
  push: true,
  notifications: true,
  serviceWorker: true,
  ios: false,
  standalone: false,
};

describe("where push can be turned on", () => {
  test.each([
    ["a desktop browser", browser, "supported"],
    ["an iPhone Home Screen app", { ...browser, ios: true, standalone: true }, "supported"],
    ["a Safari tab on iPhone (no PushManager there)", { ...browser, push: false, ios: true }, "install-first"],
    ["the desktop shell's app: scheme", { ...browser, protocol: "app:" }, "desktop-app"],
    ["a browser without push", { ...browser, push: false }, "unsupported"],
  ] as const)("%s", (_, scope, support) => {
    expect(pushSupport(scope)).toBe(support);
  });
});
