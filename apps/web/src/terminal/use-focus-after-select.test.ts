import { describe, expect, test } from "bun:test";
import { heldSelection } from "./held-selection.ts";
import { keepPressSelection } from "./use-focus-after-select.ts";

const terminal = (): Element => ({ id: "terminal" }) as unknown as Element;

/** The document selection after `wt.focus()`: the input has the keyboard, and the selection holds no range. */
function documentSelection() {
  const calls: string[] = [];
  const selection = {
    removeAllRanges: () => void calls.push("removeAllRanges"),
    addRange: () => void calls.push("addRange"),
  } as unknown as Selection;
  return { calls, selection };
}

const dragged = { collapsed: false, toString: () => "계속진행" } as unknown as Range;
const clicked = { collapsed: true, toString: () => "" } as unknown as Range;

describe("a press that selected terminal text holds it without the document's selection (#592)", () => {
  test("the dragged range is held by the terminal, not put back into the document", () => {
    const element = terminal();
    const { calls, selection } = documentSelection();
    keepPressSelection(selection, element, dragged);
    expect(calls).toEqual(["removeAllRanges"]);
    expect(heldSelection(element)?.text).toBe("계속진행");
  });

  test("a press that selected nothing holds nothing", () => {
    const element = terminal();
    const { calls, selection } = documentSelection();
    keepPressSelection(selection, element, null);
    expect(heldSelection(element)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a click's collapsed range holds nothing and leaves the input's caret alone", () => {
    const element = terminal();
    const { calls, selection } = documentSelection();
    keepPressSelection(selection, element, clicked);
    expect(heldSelection(element)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a later press lets go of what an earlier one held", () => {
    const element = terminal();
    keepPressSelection(documentSelection().selection, element, dragged);
    keepPressSelection(documentSelection().selection, element, null);
    expect(heldSelection(element)).toBeNull();
  });
});
