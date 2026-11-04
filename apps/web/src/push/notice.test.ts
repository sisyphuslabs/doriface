import type { PushHostLine, PushNotice } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { planClick } from "./notice-click.ts";
import { noticeDisplay } from "./notice-display.ts";

const notice = (k: PushNotice["k"]): PushNotice => ({
  v: 1,
  n: "AAAAAAAAAAAAAAAAAAAAAA",
  k,
  h: "abcdefghijklmnopqrstuvwxyz",
});
const URL_OF = "/?notice=AAAAAAAAAAAAAAAAAAAAAA&host=abcdefghijklmnopqrstuvwxyz";

describe("what a notice shows", () => {
  test("a permission notice offers Allow and Deny; others offer no action", () => {
    expect(noticeDisplay(notice("permission")).actions.map((action) => action.action)).toEqual(["allow", "deny"]);
    expect(noticeDisplay(notice("done")).actions).toEqual([]);
  });

  test("one notification per notice id, with nothing but a fixed text", () => {
    const shown = noticeDisplay(notice("input"));
    expect(shown.tag).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(shown.body).toBe("An agent is waiting for your input.");
  });
});

/** A host that answers every Allow / Deny with `reply`, recording what it was asked. */
const replies = (reply: PushHostLine) => {
  const asked: string[] = [];
  return { asked, answer: async (id: string, answer: string) => (asked.push(`${id}:${answer}`), reply) };
};

const unreachable = async (): Promise<PushHostLine> => {
  throw new Error("offline");
};

describe("what a tap does", () => {
  test("a tap on the notice opens its pane and answers nothing", async () => {
    const host = replies({ t: "answered", terminal: "t3" });
    expect(await planClick("", notice("permission"), host.answer)).toEqual({ open: URL_OF });
    expect(host.asked).toEqual([]);
  });

  test("Allow never answers from the notification: it opens the pane with the answer for the page to send", async () => {
    const host = replies({ t: "answered", terminal: "t3" });
    expect(await planClick("allow", notice("permission"), host.answer)).toEqual({ open: `${URL_OF}&answer=allow` });
    expect(host.asked).toEqual([]);
  });

  test("Deny that the host carried out opens nothing", async () => {
    const host = replies({ t: "answered", terminal: "t3" });
    expect(await planClick("deny", notice("permission"), host.answer)).toEqual({ open: null, answered: "t3" });
    expect(host.asked).toEqual(["AAAAAAAAAAAAAAAAAAAAAA:deny"]);
  });

  test("a stale Deny, or a host that cannot be reached, opens the pane instead", async () => {
    expect(await planClick("deny", notice("permission"), replies({ t: "stale", terminal: "t3" }).answer)).toEqual({
      open: URL_OF,
    });
    expect(await planClick("deny", notice("permission"), unreachable)).toEqual({ open: URL_OF });
  });

  test("an action on a notice that is no permission prompt answers nothing", async () => {
    const host = replies({ t: "answered", terminal: "t3" });
    expect(await planClick("deny", notice("done"), host.answer)).toEqual({ open: URL_OF });
    expect(host.asked).toEqual([]);
  });

  test("data that is no notice opens the app", async () => {
    expect(await planClick("allow", { title: "x" }, replies({ t: "ok" }).answer)).toEqual({ open: "/" });
  });
});
