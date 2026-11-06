#!/usr/bin/env bun
// A stand-in `hc` for relay-route.test.ts, reached through HC_BIN: it answers nothing and never exits, the way an hc does
// when it is blocked behind a loaded machine. The fake relay host reads `hc --version` before its first stage, so a start
// pointed at this one is blocked inside that stage — the condition #502 showed as a beforeAll that ran out its 60 s.
//
// It ends when the process that started it does, so a start its test abandons leaves no stand-in behind holding a pipe.
const starter = process.ppid;
setInterval(() => {
  try {
    process.kill(starter, 0);
  } catch {
    process.exit(0);
  }
}, 100);
