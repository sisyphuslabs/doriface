/**
 * Whether focus arriving in a pane picks it. Not wterm's own focus as a terminal starts (`starting`), which is not the
 * person picking the pane; and not when the pane is already the one in focus: it may only stand in for a pane still
 * being written (a split's), and picking it would replace that choice.
 */
export const picksPane = (starting: boolean, focused: boolean): boolean => !starting && !focused;
