import { type PromptAnswer, type PushHostLine, parsePushNotice, type PushNotice } from "@doriface/protocol";

/** The app's address for a notice: it asks the host over the push stream which pane that is and opens it. */
export const noticeUrl = (notice: PushNotice): string => `/?notice=${encodeURIComponent(notice.n)}&host=${notice.h}`;

export type ClickPlan = { readonly open: string } | { readonly open: null; readonly answered: string };

const isAnswer = (action: string): action is PromptAnswer => action === "allow" || action === "deny";

/**
 * What a tap on a notification does. A tap on the notice opens its pane. Allow or Deny asks the host to answer the
 * prompt; it sends the agent's keys only if the prompt is still the one on the live screen. If it was answered or
 * changed, or the host cannot be reached, nothing is sent and the pane opens instead, so the person sees it.
 */
export async function planClick(
  action: string,
  data: unknown,
  answer: (id: string, answer: PromptAnswer) => Promise<PushHostLine>,
): Promise<ClickPlan> {
  const notice = parsePushNotice(data);
  if (notice === undefined) return { open: "/" };
  if (notice.k !== "permission" || !isAnswer(action)) return { open: noticeUrl(notice) };
  try {
    const reply = await answer(notice.n, action);
    if (reply.t === "answered") return { open: null, answered: reply.terminal };
  } catch {
    // The host could not be reached: nothing was sent, so the pane opens and the person answers there.
  }
  return { open: noticeUrl(notice) };
}
