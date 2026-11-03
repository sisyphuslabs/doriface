/** Chromium starts the download within the click; others read the URL later, so it stays valid a while. */
const REVOKE_AFTER_MS = 60_000;

export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
