#!/usr/bin/env bun
/**
 * `DORIFACE_RELAY_READ_TOKEN` is a fine-grained token that expires, and CI reads the private relay with it, so a lapsed
 * token fails the `Relay e2e` job on every push (#38). `relay-token.json` records the day it expires and nothing else;
 * this prints a GitHub annotation from `WARN_DAYS` before that day, and an error once it has passed. The Check job
 * runs it on every push.
 *
 *   bun tests/relay-fetch/token-expiry.ts
 */
import { join } from "node:path";

const RECORD = join(import.meta.dir, "..", "..", "relay-token.json");

/** Warn from this many days before the expiry day: time to create a replacement token and swap it in. */
export const WARN_DAYS = 60;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The expiry day `relay-token.json` records. Any other field is refused: the file this alarm reads must never be the
 * place a token value lands, so a record that grew one fails instead of being read past.
 */
export function expiryOf(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("relay-token.json must be an object");
  const entries = Object.entries(raw);
  const extra = entries.map(([key]) => key).filter((key) => key !== "expires");
  if (extra.length > 0)
    throw new Error(
      `relay-token.json must hold only {"expires":"YYYY-MM-DD"}; remove ${extra.join(", ")}: the token value never goes in this file`,
    );
  const value: unknown = entries.find(([key]) => key === "expires")?.[1];
  if (typeof value !== "string" || !ISO_DAY.test(value))
    throw new Error(`relay-token.json: expires must be a YYYY-MM-DD day, not ${JSON.stringify(value)}`);
  const day = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== value)
    throw new Error(`relay-token.json: ${value} is not a day on the calendar`);
  return value;
}

/** Whole days from `now` to the start of the expiry day, UTC: 0 means it expires today, a negative count that it has. */
export function daysUntil(expires: string, now: Date): number {
  const days = Math.ceil((Date.parse(`${expires}T00:00:00Z`) - now.getTime()) / DAY_MS);
  // Inside the expiry day but past its start, `Math.ceil` answers -0, which a count must not carry.
  if (days === 0) return 0;
  return days;
}

export interface Report {
  /** `warning` and `expired` are GitHub annotations; `quiet` is a plain line that asks for nothing. */
  readonly level: "quiet" | "warning" | "expired";
  readonly days: number;
  readonly text: string;
}

const dayWord = (days: number): string => `${days} day${days === 1 ? "" : "s"}`;

/** What a run prints: an annotation from `WARN_DAYS` before the expiry day, and an error once it has passed. */
export function report(expires: string, now: Date): Report {
  const days = daysUntil(expires, now);
  if (days < 0)
    return {
      level: "expired",
      days,
      text: `::error title=Relay read token expired::DORIFACE_RELAY_READ_TOKEN expired on ${expires}. Every relay suite fails until it is rotated: docs/relay-token-rotation.md.`,
    };
  if (days === 0)
    return {
      level: "warning",
      days,
      text: `::warning title=Relay read token expires today::DORIFACE_RELAY_READ_TOKEN expires today, on ${expires}. Rotate it: docs/relay-token-rotation.md.`,
    };
  if (days <= WARN_DAYS)
    return {
      level: "warning",
      days,
      text: `::warning title=Relay read token expires soon::DORIFACE_RELAY_READ_TOKEN expires on ${expires}, in ${dayWord(days)}. Rotate it: docs/relay-token-rotation.md.`,
    };
  return { level: "quiet", days, text: `the relay read token expires on ${expires}, in ${dayWord(days)}` };
}

if (import.meta.main) {
  // Never exits non-zero for the date itself: rotating is the owner's action, and a red check would block every
  // contributor before the token is even late. A record that does not parse does fail, since that is a defect here.
  const expires = expiryOf(await Bun.file(RECORD).json());
  console.log(report(expires, new Date()).text);
}
