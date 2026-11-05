import { describe, expect, test } from "bun:test";
import { SendWindow } from "./send-window.ts";
import {
  ACK_INTERVAL_BYTES,
  decodeMux,
  encodeCredit,
  encodeCreditText,
  MuxError,
  MuxType,
  parseCreditText,
} from "./wire/index.ts";

describe("credit wire", () => {
  test("CREDIT is a u32 LE byte count for one session", () => {
    expect(decodeMux(encodeCredit(7, 65_536))).toEqual({ type: MuxType.Credit, sessionId: 7, bytes: 65_536 });
    expect(() => decodeMux(new Uint8Array([MuxType.Credit, 7, 0, 0, 0, 1, 0]))).toThrow(MuxError);
    expect(() => encodeCredit(7, -1)).toThrow(MuxError);
  });

  test("the client's c:<n> text parses and nothing else", () => {
    expect(parseCreditText(encodeCreditText(0))).toBe(0);
    expect(parseCreditText("c:65536")).toBe(65_536);
    for (const bad of ["c:", "c:-1", "c:01", "a:5", "c:5 ", "c:99999999999"])
      expect(parseCreditText(bad)).toBeUndefined();
  });
});

function sendsOf(window: SendWindow): number[] {
  const sent: number[] = [];
  for (const size of [300, 300, 300])
    window.admit(
      size,
      () => sent.push(size),
      () => {},
    );
  return sent;
}

/** A window of one credit step plus 100 bytes, after a send of `inFlight` bytes: whether a 200-byte send goes too. */
function sendAt(inFlight: number): number[] {
  const window = new SendWindow(ACK_INTERVAL_BYTES + 100);
  window.credit(0);
  const sent: number[] = [];
  window.admit(
    inFlight,
    () => sent.push(inFlight),
    () => {},
  );
  window.admit(
    200,
    () => sent.push(200),
    () => {},
  );
  return sent;
}

describe("SendWindow", () => {
  test("everything goes at once until the far side first grants credit", () => {
    expect(sendsOf(new SendWindow(500))).toEqual([300, 300, 300]);
  });

  test("once credit flows, sends wait past the window and go in order as credit returns", () => {
    const window = new SendWindow(500, 1);
    expect(window.credit(0)).toBe(true);
    const sent = sendsOf(window);
    expect(sent).toEqual([300]);
    expect(window.credit(99)).toBe(true);
    expect(sent).toEqual([300]);
    expect(window.credit(1)).toBe(true);
    expect(sent).toEqual([300, 300]);
    expect(window.credit(299)).toBe(true);
    expect(sent).toEqual([300, 300]);
    expect(window.credit(1)).toBe(true);
    expect(sent).toEqual([300, 300, 300]);
  });

  test("a residue below the 64 KiB credit step never holds back a message, even one bigger than the window", () => {
    const window = new SendWindow(500, 64);
    window.credit(0);
    const sent: number[] = [];
    window.admit(
      63,
      () => sent.push(63),
      () => {},
    );
    window.admit(
      600,
      () => sent.push(600),
      () => {},
    );
    expect(sent).toEqual([63, 600]);
    window.admit(
      10,
      () => sent.push(10),
      () => {},
    );
    expect(sent).toEqual([63, 600]);
  });

  test("the residue edge is exclusive: at one credit step in flight a send past the window waits, one byte less it goes", () => {
    expect(sendAt(ACK_INTERVAL_BYTES)).toEqual([ACK_INTERVAL_BYTES]);
    expect(sendAt(ACK_INTERVAL_BYTES - 1)).toEqual([ACK_INTERVAL_BYTES - 1, 200]);
  });

  test("a send bigger than the window goes once nothing is in flight", () => {
    const window = new SendWindow(100, 1);
    window.credit(0);
    const sent: number[] = [];
    window.admit(
      250,
      () => sent.push(250),
      () => {},
    );
    expect(sent).toEqual([250]);
  });

  test("credit for more than is in flight is refused", () => {
    const window = new SendWindow(500);
    window.admit(
      10,
      () => {},
      () => {},
    );
    expect(window.credit(11)).toBe(false);
  });

  test("drained resolves once the waiting sends went; drop fails them instead", async () => {
    const window = new SendWindow(100, 1);
    window.credit(0);
    const failed: string[] = [];
    window.admit(
      100,
      () => {},
      () => failed.push("first"),
    );
    window.admit(
      100,
      () => {},
      (error) => failed.push(error.message),
    );
    const drained = window.drained();
    const early = await Promise.race([drained.then(() => "drained"), Promise.resolve("waiting")]);
    expect(early).toBe("waiting");
    window.credit(100);
    await drained;
    window.admit(
      100,
      () => {},
      (error) => failed.push(error.message),
    );
    window.drop(new Error("closed"));
    expect(failed).toEqual(["closed"]);
  });
});
