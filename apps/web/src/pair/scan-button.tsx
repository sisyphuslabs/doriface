import { Button, Notice } from "@doriface/ui";
import { Camera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openCamera, scanOnce, type ScanHandles } from "./scan.ts";

/**
 * Returns the QR's raw text and leaves validation to the caller: the camera is untrusted input, so nothing here parses
 * or navigates on what it reads.
 */
export function ScanButton({ onText }: { readonly onText: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const camera = useRef<ScanHandles | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;

  const stop = useCallback((): void => {
    camera.current?.stop();
    camera.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const element = video.current;
    const start = async (): Promise<void> => {
      const handles = await openCamera();
      camera.current = handles;
      if (element === null) return;
      element.srcObject = handles.stream;
      await element.play();
      const text = await scanOnce(element, { signal: controller.signal });
      deliver.current(text);
      setOpen(false);
    };
    start().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setOpen(false);
    });
    return () => {
      controller.abort();
      camera.current?.stop();
      camera.current = null;
    };
  }, [open]);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {error === null ? null : (
          <Notice tone="error" title="The camera did not start">
            {error}
          </Notice>
        )}
        <Button size="lg" onClick={() => setOpen(true)}>
          <Camera aria-hidden className="size-4" />
          Scan the QR code
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <video
        ref={video}
        muted
        playsInline
        aria-label="Camera preview, looking for the host's QR code"
        className="aspect-square w-full rounded-xl bg-black object-cover"
      />
      <p role="status" className="text-center text-sm text-muted-foreground">
        Point the camera at the host&apos;s QR code.
      </p>
      <Button variant="ghost" onClick={stop}>
        Stop scanning
      </Button>
    </div>
  );
}
