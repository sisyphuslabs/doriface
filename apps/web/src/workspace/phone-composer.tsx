import { cn } from "@doriface/ui";
import { Send } from "lucide-react";
import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

/** The composer's own height: a 44 pt field row and the 0.5rem above and below it, which the terminal keeps clear. */
export const COMPOSER_HEIGHT = "3.5rem";

export interface PhoneComposerProps {
  /** Writes what the field holds, then Return, as one input to the program. */
  readonly onSend: (text: string) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The field that types for the terminal (#195): the phone's own input method composes in a real text field, so Korean
 * arrives as syllables, and nothing reaches the program until Send (or Enter) writes the line and presses Return.
 */
export function PhoneComposer(props: PhoneComposerProps) {
  const { onSend, className, style } = props;
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const send = (): void => {
    if (text === "") return;
    onSend(text);
    setText("");
    field.current?.focus();
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends, except the input method's own Enter (it commits the syllable being composed) and Shift+Enter.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };
  return (
    <form onSubmit={submit} style={style} className={cn("px-1.5 py-1", className)}>
      <div className="flex h-[3rem] items-center gap-1 rounded-full border border-border bg-chrome/95 px-1 shadow-lg backdrop-blur-md">
        <textarea
          ref={field}
          rows={1}
          value={text}
          aria-label="Type into the terminal"
          placeholder="Type into the terminal"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 resize-none bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          // Pressing it keeps the field focused, and so keeps the soft keyboard up.
          onMouseDown={(event) => event.preventDefault()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none [&_svg]:size-5 active:bg-selected focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
        >
          <Send aria-hidden />
        </button>
      </div>
    </form>
  );
}
