import { describe, expect, test } from "bun:test";
import { crashDetails } from "./crash-details.ts";

const context = { route: "/settings", userAgent: "TestAgent/1.0", at: new Date("2026-11-06T04:30:00.000Z") };

describe("crashDetails", () => {
  test("names the error, its message, the route, the browser and the time", () => {
    const error = new TypeError("cannot read 'address' of undefined");
    const text = crashDetails(error, context);
    expect(text).toContain("TypeError: cannot read 'address' of undefined");
    expect(text).toContain("Route: /settings");
    expect(text).toContain("Browser: TestAgent/1.0");
    expect(text).toContain("Time: 2026-11-06T04:30:00.000Z");
  });

  test("keeps at most 12 stack frames", () => {
    const error = new Error("deep");
    error.stack = ["Error: deep", ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (app.js:${i}:1)`)].join(
      "\n",
    );
    const frames = crashDetails(error, context)
      .split("\n")
      .filter((line) => line.trimStart().startsWith("at "));
    expect(frames).toHaveLength(12);
    expect(frames[0]).toContain("frame0");
  });

  test("keeps WebKit and Firefox frames too (fn@url:line:col), so the iOS app and Safari carry a stack", () => {
    const error = new Error("webkit");
    error.stack = [
      "render@https://app.example/assets/index.js:12:34",
      "@https://app.example/assets/index.js:1:2",
      "commitRoot@https://app.example/assets/react.js:900:10",
    ].join("\n");
    const text = crashDetails(error, context);
    expect(text).toContain("render@https://app.example/assets/index.js:12:34");
    expect(text).toContain("commitRoot@https://app.example/assets/react.js:900:10");
  });

  test("describes a thrown value that is not an Error, cut to 500 characters", () => {
    expect(crashDetails("plain string", context)).toContain("Thrown value (string): plain string");
    const long = crashDetails("x".repeat(2_000), context);
    expect(long.split("\n").find((line) => line.startsWith("Thrown value"))?.length).toBeLessThanOrEqual(
      "Thrown value (string): ".length + 501,
    );
  });

  test("never carries the query or fragment of the route (a pairing link's secret lives in the fragment)", () => {
    const text = crashDetails(new Error("x"), { ...context, route: "/pair?x=1#h=host&p=secret" });
    expect(text).toContain("Route: /pair");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("x=1");
  });
});
