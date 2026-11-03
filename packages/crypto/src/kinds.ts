import { PayloadError } from "./payloads.ts";

/** The first byte of a client's first message (contract v1.3 "Session kinds"). */
export const SessionKind = { Session: 0x01, PairCode: 0x02, PairLink: 0x03 } as const;
export type SessionKind = (typeof SessionKind)[keyof typeof SessionKind];

export const SID_LENGTH = 16;
export const SHARE_LENGTH = 32;

/** Inclusive byte bounds of a client's first message, kind byte included (contract v1.3 "Message sizes"). */
const FIRST_BOUNDS: Readonly<Record<SessionKind, readonly [number, number]>> = {
  [SessionKind.Session]: [105, 4449],
  [SessionKind.PairCode]: [164, 401],
  [SessionKind.PairLink]: [116, 353],
};

/** The host's first message: Noise message 2 (an ephemeral key, a line and its tag), after `Yb` for pair-code. */
const REPLY_MAX = 304;
const REPLY_MIN = 32 + 16;

export const isSessionKind = (byte: number | undefined): byte is SessionKind =>
  byte === SessionKind.Session || byte === SessionKind.PairCode || byte === SessionKind.PairLink;

export type FirstMessage =
  | { readonly kind: typeof SessionKind.Session | typeof SessionKind.PairLink; readonly noise: Uint8Array }
  | {
      readonly kind: typeof SessionKind.PairCode;
      readonly sid: Uint8Array;
      readonly ya: Uint8Array;
      readonly noise: Uint8Array;
    };

/** Splits a client's first message by its kind byte; an unknown kind or a size outside the kind's bounds throws. */
export function splitFirstMessage(bytes: Uint8Array): FirstMessage {
  const kind = bytes[0];
  if (!isSessionKind(kind)) throw new PayloadError("unknown session kind");
  const [min, max] = FIRST_BOUNDS[kind];
  if (bytes.byteLength < min || bytes.byteLength > max) throw new PayloadError("first message outside its size bounds");
  if (kind !== SessionKind.PairCode) return { kind, noise: bytes.subarray(1) };
  const sid = bytes.subarray(1, 1 + SID_LENGTH);
  const ya = bytes.subarray(1 + SID_LENGTH, 1 + SID_LENGTH + SHARE_LENGTH);
  return { kind, sid, ya, noise: bytes.subarray(1 + SID_LENGTH + SHARE_LENGTH) };
}

/** Checks the host's first message size for `kind`: a pair-code reply carries a 32-byte share before message 2. */
export function checkReplySize(kind: SessionKind, bytes: Uint8Array): void {
  const share = kind === SessionKind.PairCode ? SHARE_LENGTH : 0;
  if (bytes.byteLength < share + REPLY_MIN || bytes.byteLength > share + REPLY_MAX) {
    throw new PayloadError("the host's reply is outside its size bounds");
  }
}
