import { type PromptAnswer, type PushHostLine, parsePushNotice, type PushNotice } from "@doriface/protocol";

/** The app's address for a notice: it asks the host over the push stream which pane that is and opens it. */
export const noticeUrl = (notice: PushNotice, answer?: "allow"): string =>
  `/?notice=${encodeURIComponent(notice.n)}&host=${notice.h}${answer === undefined ? "" : `&answer=${answer}`}`;

export type ClickPlan = { readonly open: string } | { readonly open: null; readonly answered: string };

/**
 * What a tap on a notification does. A tap on the notice opens its pane. Allow never types from the notification,
 * which a locked device may show: it opens the pane, and the page sends the answer once it is visible. Deny asks the
 * host to answer at once; the host sends the agent's key only if the prompt is still the one on the live screen, and
 * if it was answered or changed, or the host cannot be reached, nothing is sent and the pane opens instead.
 */
export async function planClick(
  action: string,
  data: unknown,
  answer: (id: string, answer: PromptAnswer) => Promise<PushHostLine>,
): Promise<ClickPlan> {
  const notice = parsePushNotice(data);
  if (notice === undefined) return { open: "/" };
  if (notice.k !== "permission") return { open: noticeUrl(notice) };
  if (action === "allow") return { open: noticeUrl(notice, "allow") };
  if (action !== "deny") return { open: noticeUrl(notice) };
  try {
    const reply = await answer(notice.n, "deny");
    if (reply.t === "answered") return { open: null, answered: reply.terminal };
  } catch {
    // The host could not be reached: nothing was sent, so the pane opens and the person answers there.
  }
  return { open: noticeUrl(notice) };
}
