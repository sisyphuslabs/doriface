import { encodeFrame } from "@doriface/protocol";

/**
 * Wire payloads captured from hc 0.1.17, sanitized: the core id is zeroed, the host name, paths,
 * pids and timestamps are neutral. Frames are rebuilt with `frame()`, so their lengths are exact.
 */
export const CORE_ID = "0".repeat(32);
export const CORE_NAME = "example-host";

export const HELLO_REPLY_LINE = `{"id":0,"jsonrpc":"2.0","result":{"core":{"id":"${CORE_ID}","name":"${CORE_NAME}"},"features":["framed","attach","events","status","shell","resize_notifications"],"framed":true,"generation":1,"methods":["hello","server.status","server.stop","server.restart","terminal.run","templates.list","terminal.list","terminal.get","terminal.kill","terminal.rm","terminal.keep","terminal.label","terminal.read","terminal.attach","terminal.send","terminal.wait","terminal.keys","terminal.interrupt","terminal.put","machine.exec","file.read","file.write","file.edit","doc.get","doc.set","events.subscribe","machine.add","machine.list","machine.connect","machine.rename","machine.rm","rpc.discover"],"version":"0.1.17"}}`;

export const STATUS_REPLY = `{"id":1,"jsonrpc":"2.0","result":{"core":{"id":"${CORE_ID}","name":"${CORE_NAME}"},"finished":0,"holder":null,"holders":[],"installed_by":null,"live":0,"pid":4242,"uptime_ms":15,"version":"0.1.17"}}`;

export const LIST_EMPTY_REPLY = `{"id":2,"jsonrpc":"2.0","result":{"hidden_finished":0,"terminals":[]}}`;

export const RUN_REPLY = `{"id":3,"jsonrpc":"2.0","result":{"address":"t1","argv":["/bin/sh"],"cols":200,"created_ms":1700000000000,"cwd":"/home/example/work","die_with_parent":false,"exit_code":null,"finished_ms":null,"identity":"ghostty","keep":false,"labels":{"capture":"doriface"},"name":"doriface-sh","notify":true,"parent":null,"pid":4242,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}}`;

export const SUBSCRIBE_REPLY = `{"id":5,"jsonrpc":"2.0","result":{"channel":1,"seq":2,"terminals":[{"address":"t1","argv":["/bin/sh"],"cols":200,"created_ms":1700000000000,"cwd":"/home/example/work","die_with_parent":false,"exit_code":null,"finished_ms":null,"foreground":{"argv":["/bin/sh"],"cwd":"/home/example/work","name":"bash","pid":4242},"identity":"ghostty","keep":false,"labels":{"capture":"doriface"},"name":"doriface-sh","notify":true,"parent":null,"pid":4242,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}]}}`;

export const ATTACH_REPLY = `{"id":6,"jsonrpc":"2.0","result":{"channel":2,"resize_notifications":false,"terminal":{"address":"t1","argv":["/bin/sh"],"cols":100,"created_ms":1700000000000,"cwd":"/home/example/work","die_with_parent":false,"exit_code":null,"finished_ms":null,"foreground":{"argv":["/bin/sh"],"cwd":"/home/example/work","name":"bash","pid":4242},"identity":"ghostty","keep":false,"labels":{"capture":"doriface"},"name":"doriface-sh","notify":true,"parent":null,"pid":4242,"reason":null,"reported":false,"rm":false,"rows":30,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}}}`;

export const FIRST_PAINT = `\x18\x1b[!p\x1b[?2026l\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l\x1b[?2004l\x1b[?1l\x1b[?66l\x1b[?2031l\x1b[?2048l\x1b[=0;1u\x1b[?1049l\x1b[?1047l\x1b[?47l\x1b[H\x1b[2J\x1b[3g\x1b[9G\x1bH\x1b[17G\x1bH\x1b[25G\x1bH\x1b[33G\x1bH\x1b[41G\x1bH\x1b[49G\x1bH\x1b[57G\x1bH\x1b[65G\x1bH\x1b[73G\x1bH\x1b[81G\x1bH\x1b[89G\x1bH\x1b[97G\x1bH\x1b[H$ \x1b[1;3H\x1b[0m\x1b[?9001l\x0d\x1b[K$ `;

export const OUTPUT_OK = `echo doriface-ok\x0d\x0adoriface-ok\x0d\x0a$ `;

export const SIZE_EVENT = `{"jsonrpc":"2.0","method":"event","params":{"data":{"cols":100,"rows":30},"seq":3,"terminal":"t1","type":"size"}}\x0a`;

export const FINISHED_EVENT = `{"jsonrpc":"2.0","method":"event","params":{"data":{"exit_code":null,"finished_ms":1700000003000,"reason":"killed","signal":1},"seq":5,"terminal":"t1","type":"finished"}}\x0a`;

export const KILLED_CLOSE = `{"exit_code":null,"finished_ms":1700000003000,"reason":"killed","signal":1}`;

export const STOP_REPLY = `{"id":8,"jsonrpc":"2.0","result":{"stopped":true}}`;

const utf8 = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

export function frame(channel: number, kind: number, payload: string | Uint8Array = new Uint8Array(0)): Uint8Array {
  return encodeFrame(channel, kind, typeof payload === "string" ? bytes(payload) : payload);
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Gives a captured reply the id the client under test actually used. */
export function withId(reply: string, id: number): string {
  return reply.replace(/^\{"id":\d+/, `{"id":${id}`);
}
