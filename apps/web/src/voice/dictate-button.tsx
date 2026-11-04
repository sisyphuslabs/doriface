import { IconButton } from "@doriface/ui";
import { Mic, MicOff } from "lucide-react";
import type { Ref } from "react";
import type { Voice } from "./use-dictation.ts";

export interface DictateButtonProps {
  readonly voice: Voice;
  readonly target: string;
  readonly size?: "sm" | "md";
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * The mic: starts a dictation into `target`, or ends the one under way. Where the browser cannot recognize speech it
 * stays in place, crossed out and named as unavailable; pressing it says why.
 */
export function DictateButton({ voice, target, size = "md", ref }: DictateButtonProps) {
  const { dictation, state, unavailable } = voice;
  const open = state.kind !== "idle";
  return (
    <IconButton
      ref={ref}
      data-voice-mic
      label={unavailable === null ? `Dictate into ${target}` : "Dictation unavailable"}
      icon={unavailable === null ? <Mic /> : <MicOff />}
      size={size}
      pressed={open}
      {...(unavailable === null ? {} : { className: "text-muted-foreground/70" })}
      onClick={() => (open ? dictation.close() : void dictation.start())}
    />
  );
}
