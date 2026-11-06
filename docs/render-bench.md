# Render bench and the release gate

#670. herdr profiles full rendering at 1, 15 and 50 panes and runs a release smoke bench against the current stable binary before every release; doriface does the same for its web client, which is what the desktop app and the PWA draw terminals with.

## Running it

```sh
bun run bench:render                       # 1, 15 and 50 panes, the web app built from this checkout
bun run bench:render -- --panes 50 --rounds 3
bun run bench:render -- --build v0.1.2=/path/to/old/dist --build candidate=/path/to/new/dist --rounds 5 --compare v0.1.2
```

It needs `hc` on `PATH` (or `HC_BIN`) and Playwright's Chromium (`bunx playwright install chromium` in `apps/web`), as the web e2e suite does. It prints one table row per run and writes `render-bench.json` (every run) and `render-bench.md` (the table and, with `--compare`, the verdict) to `--out` (default `apps/web/bench-out`). With `--compare` it exits 1 when a gated metric regressed.

## Method

`apps/web/bench/render.bench.ts`, one Playwright test per pane count, against the e2e suite's real host and hc core (one worker, so nothing else runs on that core):

1. N terminals start on the core, each running the same `sh` program, plus one idle terminal. The core's herdr-app layout is seeded with two tabs: `bench`, the N terminals in a grid of near-equal rows (`gridOf`: 1; 5×3; 9,9,8,8,8,8 for 50), and `idle`, the idle terminal. The window is 1920×1080.
2. Every program prints a ready line and waits. Once every pane shows it, the bench starts recording and creates the go file: every program then prints the same ten-line chunk (about 800 bytes: build-log lines, a third of them in colour) every 100 ms for 60 ticks (100 lines a second per pane, about 6 s), then an end line, then a done file.
3. Visible phase, from the go file to every pane showing its end line:
   - **Frame p50 / p95 / max**: intervals between `requestAnimationFrame` callbacks from a probe added before the app's own scripts (so any build is measured the same way), nearest-rank; the run is refused under 20 frames.
   - **Main busy**: Chromium's main-thread `TaskDuration` over wall time (`Performance.getMetrics` over CDP).
   - **Long tasks**: count and total of `longtask` entries.
   - **Drawn KiB/s**: the bytes the programs wrote over the time until every pane showed its end line.
   - **Catch-up ms**: from the last program finishing to every pane showing its end line: how far drawing trails the output.
   - **Heap MB, DOM nodes**: `JSHeapUsedSize` and `Nodes` at the end.
4. Hidden phase: the `idle` tab is selected, the same workload runs again, and **Hidden busy** is the main-thread share while the `bench` tab is not shown; then the `bench` tab is selected and **Show catch-up ms** is the time until every pane shows the hidden phase's end line.

Each program starts one `sleep` per tick; at 50 panes that is 500 short processes a second on the machine, the same for every build.

## The release gate

`.github/workflows/render-bench.yml`, called by `release.yml` before the draft release is made (and runnable by hand, or by pushing a `bench/**` branch):

- the candidate's web app is built from the release commit, and the baseline's from the tag of the last published release (`gh release view`: never a draft or a prerelease);
- the candidate's bench drives both builds on the same runner (same spec, host and core: only the web app differs), every round running each build once and alternating which goes first, so drift on the runner falls on both;
- `bench/run.ts --compare` takes each gated metric's median over the rounds per pane count and fails when the candidate passes its limit in `apps/web/bench/thresholds.json`: a metric that grows when worse fails past `ratio` times the baseline **and** `floor` above it; drawn bytes per second fails under `ratio` times the baseline;
- a failure fails the release before the draft exists, so nothing is published; the table and every run are attached to the release as `doriface-<version>-render-bench.md` and `.json`.

## Noise floor

The thresholds are set from the spread of the candidate benched against itself (`bench/670-noise`, `self-a` against `self-b`) on the release workflow's runner (`ubuntu-24.04`); see `apps/web/bench/thresholds.json`, which records the run each limit came from.
