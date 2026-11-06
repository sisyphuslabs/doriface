import { SendHorizontal } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { Button, cn } from "@doriface/ui";

/** The field's height: its 44 pt row and the 4 px the bar's container pads it by. */
export const INPUT_BOX_HEIGHT = "3.25rem";

export interface InputBoxProps {
  /** Writes the text and presses Return: one line for the program, as the field shows it. */
  readonly onSend: (text: string) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The phone's line into the terminal (#666): a text field takes what is typed, so the phone's own keyboard does the
 * input method, autocorrect and Hangul composition in a real field, and Send writes the line and presses Return. The
 * field sends nothing before Send, which is the difference from typing in the terminal itself.
 */
export function InputBox({ onSend, className, style }: InputBoxProps) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const send = (): void => {
    if (text.trim() === "") return;
    onSend(text);
    setText("");
    field.current?.focus();
  };
  // Enter sends; Shift+Enter is a line of its own. A key that is still composing a Hangul syllable belongs to the
  // input method, which commits on it, and never to Send.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className={cn("flex items-end gap-1 px-1.5 py-1", className)} style={style}>
      <textarea
        ref={field}
        rows={1}
        autoFocus
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={text}
        aria-label="Type into the terminal"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          "h-11 min-w-0 flex-1 resize-none rounded-full border border-input bg-chrome/95 px-3.5 py-2.5 font-mono text-base text-foreground",
          "shadow-lg outline-none backdrop-blur-md placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
        )}
        placeholder="Type here, then Send"
      />
      <Button
        type="button"
        variant="primary"
        aria-label="Send"
        disabled={text.trim() === ""}
        // A press that moved focus to this button would put the phone's keyboard down mid-sentence.
        onMouseDown={(event) => event.preventDefault()}
        onClick={send}
        className="size-11 shrink-0 rounded-full p-0"
      >
        <SendHorizontal aria-hidden className="size-5" />
      </Button>
    </div>
  );
}
