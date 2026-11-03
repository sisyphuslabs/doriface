import { statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { APP_HOST } from "../config/origin.ts";

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

/**
 * Maps an `app://doriface/...` request onto a file under `root`. Paths that escape the root or name another
 * host resolve to nothing; an extensionless miss falls back to index.html so client-side routes reload.
 */
export function resolveAsset(root: string, requestUrl: string): string | undefined {
  const url = URL.parse(requestUrl);
  if (url === null || url.host !== APP_HOST) return undefined;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) return undefined;
  const file = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  const inside = relative(root, file);
  if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
  if (isFile(file)) return file;
  const index = join(root, "index.html");
  return extname(file) === "" && isFile(index) ? index : undefined;
}
