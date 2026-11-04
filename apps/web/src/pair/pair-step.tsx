import { Button, Field, Input, Notice } from "@doriface/ui";
import { useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { formatCode, normalizeCode } from "./code.ts";
import type { PairingOffer } from "./fragment.ts";
import { parsePairingFragment } from "./fragment.ts";
import { lookupCode } from "./lookup.ts";
import { Steps } from "./steps.tsx";

/** Takes the 8-character code doriface-host pair shows (or its link) and moves to Verify. */
export function PairStep({
  onOffer,
  offline = false,
}: {
  readonly onOffer: (offer: PairingOffer) => void;
  readonly offline?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const link = text.indexOf("#");
    const code = normalizeCode(text);
    if (link === -1 && code === null) return setError("Enter the 8 characters the host shows.");
    setBusy(true);
    const parsed =
      link !== -1
        ? parsePairingFragment(text.slice(link))
        : await lookupCode(code ?? "", connectionStore.settings.relayUrl);
    setBusy(false);
    if (parsed.ok) onOffer(parsed.offer);
    else setError(parsed.reason);
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-6 py-10">
      {offline ? (
        <Notice tone="warning" title="You are offline">
          Pairing needs a network: the code is looked up through the relay. Try again once it is back.
        </Notice>
      ) : null}
      <Steps current={1} />
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-balance text-foreground">Pair this device</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          Scan the code shown by the host with this device's camera, or type its pairing code.
        </p>
      </div>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Pairing code"
          htmlFor="pair-code"
          hint="8 characters, letters and digits"
          error={error ?? undefined}
        >
          <Input
            id="pair-code"
            mono
            value={text}
            invalid={error !== null}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX XXXX"
            className="h-(--control-lg) text-center text-lg"
            onValueChange={(value: string) => {
              const code = normalizeCode(value);
              setText(code === null ? value : formatCode(code));
              setError(null);
            }}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          The code reaches your host through the relay, which only sees encrypted traffic.
        </p>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={text.trim() === ""}>
          Pair
        </Button>
      </form>
    </main>
  );
}
