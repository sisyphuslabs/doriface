import { afterEach, describe, expect, jest, test } from "bun:test";
import { FIRST_SHOW_DEADLINE_MS } from "../src/config/window.ts";
import { revealWhenReady } from "../src/main/window-reveal.ts";

afterEach(() => jest.useRealTimers());

/** A window's show and its ready-to-show and closed events, recorded. */
function fakeWindow() {
  const listeners = new Map<string, () => void>();
  let shows = 0;
  let visible = false;
  let destroyed = false;
  const window = {
    show: () => {
      shows += 1;
      visible = true;
    },
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    onReady: (listener: () => void) => void listeners.set("ready", listener),
    onClosed: (listener: () => void) => void listeners.set("closed", listener),
  };
  const fire = (name: "ready" | "closed"): void => {
    if (name === "closed") destroyed = true;
    listeners.get(name)?.();
  };
  return { window, fire, shows: () => shows };
}

describe("the first show of the window", () => {
  test("is the first frame when it comes before the deadline, and the deadline then shows nothing more", () => {
    jest.useFakeTimers();
    const { window, fire, shows } = fakeWindow();
    revealWhenReady(window);
    fire("ready");
    expect(shows()).toBe(1);
    jest.advanceTimersByTime(FIRST_SHOW_DEADLINE_MS * 2);
    expect(shows()).toBe(1);
  });

  test("is the deadline when no frame has come by then, and a late frame shows nothing more", () => {
    jest.useFakeTimers();
    const { window, fire, shows } = fakeWindow();
    revealWhenReady(window);
    jest.advanceTimersByTime(FIRST_SHOW_DEADLINE_MS - 1);
    expect(shows()).toBe(0);
    jest.advanceTimersByTime(1);
    expect(shows()).toBe(1);
    fire("ready");
    expect(shows()).toBe(1);
  });

  test("never happens for a window closed before either", () => {
    jest.useFakeTimers();
    const { window, fire, shows } = fakeWindow();
    revealWhenReady(window);
    fire("closed");
    jest.advanceTimersByTime(FIRST_SHOW_DEADLINE_MS * 2);
    expect(shows()).toBe(0);
  });
});
