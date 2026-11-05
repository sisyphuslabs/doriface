import type { PushHostLine } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { noticeOf } from "./notice-open.ts";
import { allowFromPage, whenVisible } from "./prompt-answer.ts";

/** A document whose visibility the test flips, firing visibilitychange as a browser does. */
/** A host that cannot be reached. */
const offline = async (): Promise<PushHostLine> => {
  throw new Error("offline");
};
const at = (search: string) => noticeOf(new URL(`https://app.example/${search}`));

function page(state: DocumentVisibilityState) {
  const listeners = new Set<() => void>();
  return {
    get visibilityState() {
      return state;
    },
    addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
    show() {
      state = "visible";
      for (const listener of listeners) listener();
    },
  };
}

describe("Allow from the page", () => {
  test("sends nothing while the page is hidden, and sends once it is visible", async () => {
    const doc = page("hidden");
    const sent: string[] = [];
    const done = allowFromPage(
      "t3",
      async () => {
        sent.push("allow");
        return { t: "answered", terminal: "t3" };
      },
      () => whenVisible(doc),
    );
    await Promise.resolve();
    expect(sent).toEqual([]);
    doc.show();
    expect(await done).toBe("answered");
    expect(sent).toEqual(["allow"]);
  });

  test.each([
    ["the host answered", { t: "answered", terminal: "t3" }, "answered"],
    ["the prompt had gone", { t: "stale", terminal: "t3" }, "stale"],
    ["the host refused", { t: "error", reason: "x" }, "failed"],
    ["the answer did not go through", { t: "failed", terminal: "t3", reason: "link dropped" }, "failed"],
    ["the key press may have landed", { t: "unknown", terminal: "t3" }, "unknown"],
  ] as const)("%s", async (_, reply: PushHostLine, phase) => {
    expect(
      await allowFromPage(
        "t3",
        async () => reply,
        async () => undefined,
      ),
    ).toBe(phase);
  });

  test("a host that cannot be reached sends nothing", async () => {
    expect(await allowFromPage("t3", offline, async () => undefined)).toBe("failed");
  });

  test("only answer=allow in the address asks the page to answer", () => {
    expect(at("?notice=AAAAAAAAAAAAAAAAAAAAAA&host=h&answer=allow")?.allow).toBe(true);
    expect(at("?notice=AAAAAAAAAAAAAAAAAAAAAA&host=h&answer=deny")?.allow).toBe(false);
    expect(at("?notice=AAAAAAAAAAAAAAAAAAAAAA&host=h")?.allow).toBe(false);
  });
});
