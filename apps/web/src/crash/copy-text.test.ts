import { describe, expect, test } from "bun:test";
import { copyText } from "./copy-text.ts";

describe("copyText", () => {
  test("writes the text to the clipboard and reports copied", async () => {
    const written: string[] = [];
    let selected = 0;
    const outcome = await copyText("details", { writeText: async (text) => void written.push(text) }, () => selected++);
    expect(outcome).toBe("copied");
    expect(written).toEqual(["details"]);
    expect(selected).toBe(0);
  });

  test("selects the text instead when the clipboard refuses", async () => {
    let selected = 0;
    const refuse = { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) };
    expect(await copyText("details", refuse, () => selected++)).toBe("selected");
    expect(selected).toBe(1);
  });

  test("selects the text when there is no clipboard (an insecure origin)", async () => {
    let selected = 0;
    expect(await copyText("details", undefined, () => selected++)).toBe("selected");
    expect(selected).toBe(1);
  });
});
