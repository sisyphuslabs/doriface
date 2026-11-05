import { describe, expect, test } from "bun:test";
import { copiedText } from "./copied-text.ts";

describe("copiedText", () => {
  test("each line loses the spaces and tabs after its text, and the blank rows after the last text go", () => {
    expect(copiedText("$ echo hi   \nhi\t \n$ \n\n\n", true)).toBe("$ echo hi\nhi\n$");
  });

  test("spaces inside a line, and blank lines between text, stay", () => {
    expect(copiedText("a  b\n\nc ", true)).toBe("a  b\n\nc");
  });

  test("with the setting off the selection is copied as it is", () => {
    expect(copiedText("a  \n\n", false)).toBe("a  \n\n");
  });
});
