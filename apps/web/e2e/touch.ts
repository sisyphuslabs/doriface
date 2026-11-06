import type { CDPSession, Page } from "@playwright/test";

export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A finger, through the browser's own input pipeline: Chromium turns these into pointer events with pointerType
 * "touch", which a mouse cannot produce and which is what the terminal's held press listens for (#195).
 */
export class Touch {
  readonly #client: CDPSession;

  private constructor(client: CDPSession) {
    this.#client = client;
  }

  static async on(page: Page): Promise<Touch> {
    return new Touch(await page.context().newCDPSession(page));
  }

  async down(at: TouchPoint): Promise<void> {
    await this.#send("touchStart", [{ x: at.x, y: at.y }]);
  }

  /** Moves the finger in one step, as a drag that has already reached `at`. */
  async move(at: TouchPoint): Promise<void> {
    await this.#send("touchMove", [{ x: at.x, y: at.y }]);
  }

  /** Moves in `steps` even steps, as a scroll or a drag does, ending at `at`. */
  async drag(from: TouchPoint, at: TouchPoint, steps = 6): Promise<void> {
    for (let step = 1; step <= steps; step++) {
      await this.move({ x: from.x + ((at.x - from.x) * step) / steps, y: from.y + ((at.y - from.y) * step) / steps });
    }
  }

  async up(at: TouchPoint): Promise<void> {
    await this.#send("touchEnd", [{ x: at.x, y: at.y }], []);
  }

  async tap(at: TouchPoint): Promise<void> {
    await this.down(at);
    await this.up(at);
  }

  async #send(type: string, points: readonly TouchPoint[], release?: readonly TouchPoint[]): Promise<void> {
    await this.#client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: release ?? points.map(({ x, y }) => ({ x, y })),
    });
  }
}
