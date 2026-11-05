// This run's own $TMPDIR (see pinRunDir): imported first by playwright.config.ts, before anything reads tmpdir().
import { pinRunDir } from "@doriface/host/testing/run-dir";

export const RUN_DIR = pinRunDir("dwr-");
