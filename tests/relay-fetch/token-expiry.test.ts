import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { daysUntil, expiryOf, report, type Report } from "./token-expiry.ts";

const at = (instant: string): Date => new Date(instant);
const EXPIRES = "2027-02-01";

describe("relay-token.json", () => {
  test("is read for nothing but the day the token expires", () => {
    expect(expiryOf({ expires: EXPIRES })).toBe(EXPIRES);
  });

  test("refuses a record carrying any other field, so a token value can never land beside the date", () => {
    expect(() => expiryOf({ expires: EXPIRES, token: "example-value" })).toThrow(/remove token/);
  });

  test("refuses anything that is not a day on the calendar", () => {
    const records: readonly unknown[] = [
      null,
      [EXPIRES],
      EXPIRES,
      {},
      { expires: "2027-2-1" },
      { expires: "01-02-2027" },
      { expires: "2027-02-30" },
      { expires: 20270201 },
    ];
    for (const record of records) expect(() => expiryOf(record)).toThrow();
  });

  test("the file this repository ships parses", async () => {
    const raw: unknown = await Bun.file(join(import.meta.dir, "..", "..", "relay-token.json")).json();
    expect(expiryOf(raw)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the expiry alarm", () => {
  const cases: readonly { readonly now: string; readonly level: Report["level"]; readonly days: number }[] = [
    { now: "2026-12-02T00:00:00Z", level: "quiet", days: 61 },
    { now: "2026-12-03T00:00:00Z", level: "warning", days: 60 },
    { now: "2026-12-03T00:00:01Z", level: "warning", days: 60 },
    { now: "2027-01-31T00:00:00Z", level: "warning", days: 1 },
    { now: "2027-02-01T00:00:00Z", level: "warning", days: 0 },
    { now: "2027-02-02T00:00:00Z", level: "expired", days: -1 },
  ];

  test("is quiet past the warning window, warns inside it, and errors once the day has passed", () => {
    for (const row of cases) {
      const said = report(EXPIRES, at(row.now));
      expect({ now: row.now, level: said.level, days: said.days }).toEqual({
        now: row.now,
        level: row.level,
        days: row.days,
      });
    }
  });

  test("names the expiry day, the days left and the runbook in the annotation a workflow prints", () => {
    const warned = report(EXPIRES, at("2026-12-03T00:00:00Z")).text;
    expect(warned.startsWith("::warning title=")).toBe(true);
    expect(warned).toContain(EXPIRES);
    expect(warned).toContain("60 days");
    expect(warned).toContain("docs/relay-token-rotation.md");

    const expired = report(EXPIRES, at("2027-02-02T00:00:00Z")).text;
    expect(expired.startsWith("::error title=")).toBe(true);
    expect(expired).toContain("docs/relay-token-rotation.md");
  });

  test("counts a day as whole from the start of the expiry day in UTC", () => {
    expect(daysUntil(EXPIRES, at("2026-12-03T00:00:00Z"))).toBe(60);
    expect(daysUntil(EXPIRES, at("2026-12-03T00:00:01Z"))).toBe(60);
    expect(daysUntil(EXPIRES, at("2027-02-01T23:59:59Z"))).toBe(0);
  });
});
