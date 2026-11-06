import type { MeshMemberStatus } from "@doriface/protocol";

/** How this host reaches a member right now: over a herdr line of its own, through the relay, or not at all. */
export type Reach = "this-host" | "direct-line" | "through-the-relay" | "no-session";

/**
 * A member with an open mesh session and a connected herdr line is reached over that line (herdr-core native, direct).
 * A session with no connected line arrives through the relay. Presence is the only proof something is reached now: a
 * line herdr holds without a session says nothing about the mesh exchange, and a line state is the reconciler's last
 * word, not herdr's live one (#754).
 */
export function reachOf(member: Pick<MeshMemberStatus, "line" | "presence">): Reach {
  if (member.line === "self") return "this-host";
  if (!member.presence) return "no-session";
  return member.line === "connected" ? "direct-line" : "through-the-relay";
}

export const REACH_LABEL: Readonly<Record<Reach, string>> = {
  "this-host": "this host",
  "direct-line": "session open over a direct line",
  "through-the-relay": "session open through the relay",
  "no-session": "no session now",
};
