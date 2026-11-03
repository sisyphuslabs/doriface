import type { MenuItemConstructorOptions } from "electron";

/** The part of Electron's context-menu params the menu depends on. */
export interface ContextTarget {
  readonly isEditable: boolean;
  readonly selectionText: string;
  readonly editFlags: { readonly canCut: boolean; readonly canCopy: boolean; readonly canPaste: boolean };
}

/**
 * The native right-click menu: Cut, Copy, Paste and Select All in a text field, Copy over selected text, and no menu
 * elsewhere. Roles carry the platform's labels, shortcuts and enabled state.
 */
export function contextMenuTemplate(target: ContextTarget): MenuItemConstructorOptions[] {
  if (target.isEditable) {
    return [
      { role: "cut", enabled: target.editFlags.canCut },
      { role: "copy", enabled: target.editFlags.canCopy },
      { role: "paste", enabled: target.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll" },
    ];
  }
  return target.selectionText.trim() === "" ? [] : [{ role: "copy" }];
}
