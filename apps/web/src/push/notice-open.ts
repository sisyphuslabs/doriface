import { isNoticeId } from "@doriface/protocol";
import { useEffect, useSyncExternalStore } from "react";
import { noticeBridge } from "./desktop-notices.ts";
import { pushChannel } from "./push-channel.ts";
import { allowFromPage, whenVisible } from "./prompt-answer.ts";

export interface PendingNotice {
  readonly id: string;
  readonly host: string;
  /** Allow was tapped on the notification: the page sends it once visible, after the pane opens. */
  readonly allow: boolean;
}

/** A clicked desktop notification names its terminal itself: no host round trip. */
interface ClickedTerminal {
  readonly terminal: string;
}

let pending: PendingNotice | ClickedTerminal | null = null;
const listeners = new Set<() => void>();
const set = (next: PendingNotice | ClickedTerminal | null): void => {
  pending = next;
  for (const listener of listeners) listener();
};

/** A notice a tap opened the app with (`/?notice=<id>&host=<hostId>[&answer=allow]`), or null. */
export function noticeOf(url: URL): PendingNotice | null {
  const id = url.searchParams.get("notice");
  if (!isNoticeId(id)) return null;
  return { id, host: url.searchParams.get("host") ?? "", allow: url.searchParams.get("answer") === "allow" };
}

/** Reads a tapped notice from the address once and takes it out of the address bar and history. */
export function captureNotice(): void {
  const url = new URL(location.href);
  const notice = noticeOf(url);
  if (notice === null) return;
  url.searchParams.delete("notice");
  url.searchParams.delete("host");
  url.searchParams.delete("answer");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  set(notice);
}

/**
 * A tap while the app is open: the service worker focuses this window and posts the notice's address. The pane opens
 * in the workspace, so a window showing another screen (Settings) goes there first, through `toWorkspace`.
 */
export function listenForNotices(toWorkspace: () => void): void {
  navigator.serviceWorker?.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null || Reflect.get(data, "type") !== "doriface-notice") return;
    const url = Reflect.get(data, "url");
    if (typeof url !== "string" || !URL.canParse(url, location.origin)) return;
    const notice = noticeOf(new URL(url, location.origin));
    if (notice === null) return;
    set(notice);
    toWorkspace();
  });
}

/** A click on a desktop notification opens its pane in the workspace, reached through `toWorkspace`. */
export function listenForDesktopNotices(toWorkspace: () => void, scope: object = globalThis): void {
  noticeBridge(scope)?.onClick((terminal) => {
    if (terminal !== null) set({ terminal });
    toWorkspace();
  });
}

/**
 * Opens the pane a tapped notice is about: the push carried only an id, so the host is asked over the push stream
 * which terminal it was. A notice from another host, or one the host no longer knows, opens nothing more.
 */
export function useNoticeOpen(hostId: string | undefined, open: (address: string) => void): void {
  const notice = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  useEffect(() => {
    if (notice === null) return;
    set(null);
    if ("terminal" in notice) {
      open(notice.terminal);
      return;
    }
    if (hostId !== undefined && notice.host !== hostId) return;
    void openNotice(notice, open);
  }, [notice, hostId, open]);
}

async function openNotice(notice: PendingNotice, open: (address: string) => void): Promise<void> {
  let terminal: string | null = null;
  try {
    const reply = await pushChannel.request({ t: "notice", id: notice.id });
    if (reply.t === "notice") terminal = reply.terminal;
  } catch {
    // Without the push stream the app stays where it opened; the notice itself says what happened.
  }
  if (terminal === null) return;
  open(terminal);
  if (!notice.allow) return;
  await allowFromPage(
    terminal,
    () => pushChannel.request({ t: "answer", id: notice.id, answer: "allow" }),
    () => whenVisible(document),
  );
}
