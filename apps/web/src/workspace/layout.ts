/** Workspace layout choices that outlive a reload, kept beside the other local settings (doriface.appearance). */
export interface Layout {
  readonly sidebar: boolean;
}

export const LAYOUT_KEY = "doriface.layout";
const DEFAULT: Layout = { sidebar: true };

export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): Layout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(LAYOUT_KEY) ?? "null");
  } catch {
    return DEFAULT;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT;
  const sidebar: unknown = Reflect.get(parsed, "sidebar");
  return { sidebar: typeof sidebar === "boolean" ? sidebar : DEFAULT.sidebar };
}
