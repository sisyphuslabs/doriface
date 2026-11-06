import { parsePairingFragment, type PairingParse } from "./fragment.ts";

export type ScanDecoder = "barcode-detector" | "jsqr" | "none";

/** What a decoded code means: only a pairing link is accepted, and only through the spec's own parser. */
export function offerFromScan(text: string): PairingParse {
  const hash = text.indexOf("#");
  if (hash === -1) return { ok: false, reason: "That code is not an invite link: it carries no invite." };
  return parsePairingFragment(text.slice(hash));
}

/**
 * BarcodeDetector ships on Android Chrome and not on iOS Safari, so the bundled decoder is the fallback; a browser can
 * also expose the API without supporting qr_code, hence the question rather than the assumption.
 */
export async function chooseDecoder(): Promise<ScanDecoder> {
  const detector = Reflect.get(globalThis, "BarcodeDetector");
  if (typeof detector === "function") {
    try {
      const formats: unknown = await Reflect.get(detector, "getSupportedFormats").call(detector);
      if (Array.isArray(formats) && formats.includes("qr_code")) return "barcode-detector";
    } catch {
      return "jsqr";
    }
  }
  return "jsqr";
}

export interface ScanHandles {
  readonly stream: MediaStream;
  readonly stop: () => void;
}

/** Opens the rear camera. The caller owns the stream and must call `stop`. */
export async function openCamera(): Promise<ScanHandles> {
  const media = navigator.mediaDevices;
  if (media === undefined || typeof media.getUserMedia !== "function") {
    throw new Error("This browser has no camera access. Open the invite link instead.");
  }
  const stream = await media.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  return { stream, stop: () => stream.getTracks().forEach((track) => track.stop()) };
}

interface DetectedCode {
  readonly rawValue?: unknown;
}

async function detectOnce(video: HTMLVideoElement, decoder: ScanDecoder): Promise<string | undefined> {
  if (video.readyState < video.HAVE_CURRENT_DATA) return undefined;
  if (decoder === "barcode-detector") {
    const Detector = Reflect.get(globalThis, "BarcodeDetector");
    if (typeof Detector !== "function") return undefined;
    const detector = new Detector({ formats: ["qr_code"] });
    const codes: unknown = await detector.detect(video);
    if (!Array.isArray(codes)) return undefined;
    for (const code of codes as DetectedCode[]) {
      const value = code.rawValue;
      if (typeof value === "string" && value !== "") return value;
    }
    return undefined;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (canvas.width === 0 || canvas.height === 0) return undefined;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return undefined;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
  return found?.data === undefined || found.data === "" ? undefined : found.data;
}

export async function scanOnce(
  video: HTMLVideoElement,
  options: { readonly signal?: AbortSignal; readonly everyMs?: number; readonly timeoutMs?: number } = {},
): Promise<string> {
  const decoder = await chooseDecoder();
  if (decoder === "none") throw new Error("This browser cannot read QR codes. Open the invite link instead.");
  const everyMs = options.everyMs ?? 250;
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopBecause = (reason: string): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new Error(reason));
    };
    const tick = async (): Promise<void> => {
      if (options.signal?.aborted === true) return stopBecause("The scan was stopped.");
      let text: string | undefined;
      try {
        text = await detectOnce(video, decoder);
      } catch (cause) {
        return stopBecause(cause instanceof Error ? cause.message : String(cause));
      }
      if (text !== undefined) {
        if (timer !== undefined) clearTimeout(timer);
        return resolve(text);
      }
      if (Date.now() > deadline) {
        return stopBecause("No QR code was read. Move closer, or open the invite link instead.");
      }
      timer = setTimeout(() => void tick(), everyMs);
    };
    void tick();
  });
}
