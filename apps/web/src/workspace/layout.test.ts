import { describe, expect, test } from "bun:test";
import { loadLayout } from "./layout.ts";

const stored = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });

describe("loadLayout", () => {
  test("reads a stored hidden sidebar, and shows it when nothing usable is stored", () => {
    expect(loadLayout(stored('{"sidebar":false}'))).toEqual({ sidebar: false });
    expect(loadLayout(stored(null))).toEqual({ sidebar: true });
    expect(loadLayout(stored("{not json"))).toEqual({ sidebar: true });
    expect(loadLayout(stored('{"sidebar":"no"}'))).toEqual({ sidebar: true });
  });
});
