import { expect, test } from "bun:test";
import { SOCKET_DEPTH, SOCKET_PATH_MAX, socketSafeBase } from "./short-tmp.ts";

test.if(process.platform !== "win32")(
  "a $TMPDIR that leaves room for the deepest socket is kept, one byte deeper is not (#509)",
  () => {
    const fits = `/${"a".repeat(SOCKET_PATH_MAX - SOCKET_DEPTH - 1)}`;
    expect(socketSafeBase(fits)).toBe(fits);
    expect(socketSafeBase(`${fits}b`)).toBe("/tmp");
    expect(socketSafeBase(`/srv/${"x".repeat(85)}`)).toBe("/tmp");
  },
);
