import type { Answerer } from "@doriface/protocol";
import { deviceName } from "../pair/device-name.ts";

let self: Answerer | undefined;

/** This page as an answerer: its device name for people, and an id of its own, so two tabs of one browser differ. */
export function thisAnswerer(): Answerer {
  self ??= { by: deviceName(), client: crypto.randomUUID() };
  return self;
}
