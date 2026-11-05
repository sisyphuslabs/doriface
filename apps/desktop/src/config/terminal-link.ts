/**
 * A link a terminal printed (a plain URL or an OSC 8 hyperlink): unlike the shell's own external links, any host may
 * open, since the person chose to open it, but only http, https and mailto, and never one carrying credentials.
 * Callers open this exact string.
 */
export function terminalLinkTarget(candidate: string): string | undefined {
  const url = URL.parse(candidate);
  if (url === null || url.username !== "" || url.password !== "") return undefined;
  return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : undefined;
}
