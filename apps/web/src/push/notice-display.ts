import type { NoticeKind, PushNotice } from "@doriface/protocol";

const BODY: Readonly<Record<NoticeKind, string>> = {
  input: "An agent is waiting for your input.",
  permission: "An agent is asking for permission.",
  done: "An agent finished its turn.",
  error: "An agent stopped with an error.",
  test: "Notifications from this host work.",
};

/** The two answers a permission notice offers where the platform shows notification actions. */
export const ANSWER_ACTIONS = [
  { action: "allow", title: "Allow" },
  { action: "deny", title: "Deny" },
] as const;

export interface NoticeDisplay {
  readonly title: string;
  readonly body: string;
  /** One notification per notice: a repeated delivery replaces it instead of stacking. */
  readonly tag: string;
  readonly data: PushNotice;
  readonly actions: readonly { readonly action: string; readonly title: string }[];
  readonly requireInteraction: boolean;
}

/** What the service worker shows: a fixed text per kind. The payload holds nothing more, by design. */
export function noticeDisplay(notice: PushNotice): NoticeDisplay {
  const asks = notice.k === "permission";
  return {
    title: "doriface",
    body: BODY[notice.k],
    tag: notice.n,
    data: notice,
    actions: asks ? ANSWER_ACTIONS : [],
    requireInteraction: asks || notice.k === "input",
  };
}
