/** Where a split's new terminal goes once its document write settles. */
export type SplitLanding = "split" | "own-tab" | "here";

/**
 * In the split when the write landed. When the pane it split had closed on another device first (`gone`), in a tab of
 * its own. When the write failed, which the edit has already reported, on this screen as a tab of its own here, so the
 * terminal started for the split is never left without a place.
 */
export const splitLanding = (placed: boolean, gone: boolean): SplitLanding =>
  placed ? "split" : gone ? "own-tab" : "here";
