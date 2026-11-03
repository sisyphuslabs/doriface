# Visual QA of the shipped web app

Verdict: **GOOD**. Every screen passes in day and night at 1440 and 390 after the fixes below.

Captured: 22 screens x {1440, 390 (iPhone 14 emulation)} x {day, night} = 88 PNGs in `docs/design/app/`, produced by `CAPTURE=1 bunx playwright test capture` (apps/web/e2e/capture.e2e.ts) against the e2e loopback host and seeded terminals. Pairing screens run against an in-browser fake relay (`wss://relay.invalid`, `page.route` / `routeWebSocket`), so no capture touches a real relay or this machine's identity. Every capture was taken after the last source edit and viewed.

Detect lint (frontend skill, chrome backend, reflow off) on first run, pair, settings and workspace, day and night, 1440 and 390: 0 findings on all 8 runs.

## Per screen x theme x width

| Screen                    | 1440 day       | 1440 night     | 390 day        | 390 night      |
| ------------------------- | -------------- | -------------- | -------------- | -------------- |
| first-run                 | PASS           | PASS           | PASS           | PASS           |
| pair                      | PASS (E1)      | PASS (E1)      | PASS (E1)      | PASS (E1)      |
| pair-code                 | PASS           | PASS           | PASS           | PASS           |
| pair-code-verify          | PASS (E2)      | PASS (E2)      | PASS (E2)      | PASS (E2)      |
| pair-verify               | PASS (E2)      | PASS (E2)      | PASS (E2)      | PASS (E2)      |
| pair-link-invalid         | D3 fixed       | D3 fixed       | D3 fixed       | D3 fixed       |
| pair-mismatch             | PASS           | PASS           | PASS           | PASS           |
| pair-code-mismatch        | D2 fixed       | D2 fixed       | D2 fixed       | D2 fixed       |
| pair-refused-4410         | PASS           | PASS           | PASS           | PASS           |
| pair-refused-4429         | PASS           | PASS           | PASS           | PASS           |
| workspace                 | D1 fixed       | D1 fixed       | D1 fixed       | D1 fixed       |
| terminal                  | PASS (T1)      | PASS (T1)      | PASS (T1)      | PASS (T1)      |
| palette                   | D1, D5 fixed   | D1, D5 fixed   | D1, D5 fixed   | D1, D5 fixed   |
| settings                  | PASS           | PASS           | PASS           | PASS           |
| settings-appearance       | PASS           | PASS           | PASS           | PASS           |
| settings-appearance-end   | PASS           | PASS           | PASS           | PASS           |
| settings-terminal         | PASS           | PASS           | PASS           | PASS           |
| settings-terminal-end     | PASS           | PASS           | PASS           | PASS           |
| settings-keybindings      | D7 fixed (390) | D7 fixed (390) | D7 fixed (390) | D7 fixed (390) |
| settings-keybindings-end  | D7, D8 fixed   | D7, D8 fixed   | D7, D8 fixed   | D7, D8 fixed   |
| storage-error             | D6 fixed       | D6 fixed       | D6 fixed       | D6 fixed       |
| storage-error-keybindings | D6, D7 fixed   | D6, D7 fixed   | D6, D7 fixed   | D6, D7 fixed   |

Cells that name a defect were FAIL before the fix and PASS on the recaptured image.

## Defects fixed (one commit each)

| Id  | Screen                     | Defect                                                                                                                                              | Fix                                                                                                                                                                                 | Test                          |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| D1  | workspace, palette         | No command palette in the shipped app, although DESIGN.md brief (c), the ⌘⇧P journey and the shell mockup's search and "Commands" entry require one | Palette over the dimmed shell: sidebar search, status bar "⌘⇧P Commands", phone header search, `app.palette` bound to super/ctrl+shift+p; Agents / Actions / Hosts / General groups | palette-commands.test.ts      |
| D5  | palette                    | Agents listed in terminal order, so the agent that needs you was not first                                                                          | Agents sorted by urgency, as the sidebar sections are                                                                                                                               | palette-commands.test.ts      |
| D2  | pair-code-mismatch         | After a typed code, the mismatch notice said "this link may not come from it"                                                                       | Copy per pairing mode: code -> "this code may have reached another host ... type the new code"                                                                                      | n/a (copy)                    |
| D3  | pair-link-invalid          | Unusable link screen was a dead end with no action                                                                                                  | Primary "Type a pairing code" leads to /pair                                                                                                                                        | n/a (markup)                  |
| D6  | storage-error              | Engine message appended without punctuation ("... IndexedDB is not available here")                                                                 | `asSentence` ends it as a sentence                                                                                                                                                  | sentence.test.ts              |
| D7  | settings-keybindings (390) | Key chips hidden on coarse pointers, leaving orphan remove buttons                                                                                  | Chips are the binding's value: `Kbd persistent`                                                                                                                                     | n/a (markup; seen in capture) |
| D8  | settings-keybindings-end   | `send:` ids printed raw control bytes (blank or "send: b")                                                                                          | `displayActionId` renders \\xNN                                                                                                                                                     | actions.test.ts               |

## Evidence-only findings (no product change)

- E1: disabled Pair button shows faint vertical tile seams in headless Chromium only; WebKit renders it clean (checked side by side). Software-raster artifact.
- E2: a hover wash on "They don't match" and mid-fade buttons in early runs; the capture now parks the pointer and disables animations before each shot.

## Recorded taste findings

- T1: terminal text sits 2 pt from the pane edge; that is Ghostty's own `window-padding` default, set on purpose and user-configurable.
- The 390 settings tab list scrolls horizontally and cuts "Keybindings"; the partial label is the scroll cue (checklist A10).

## Completion gate

Round 1: implementing session, 88/88 viewed. Round 2: independent code review of #29 at d77d9b9 returned FIX_FIRST (D9 HIGH; hard-coded hints, untested binding, capture shots without content waits, a test that checked only id parsing); all fixed with tests that failed first. Capture shots now wait for each screen's content; all 88 recaptured, palette and workspace re-viewed.
