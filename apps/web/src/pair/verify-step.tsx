import { Button, Fingerprint, Notice } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { connectionStore } from "../connection/store.ts";
import type { PairingOffer } from "./fragment.ts";
import { Steps } from "./steps.tsx";

type Outcome = "pending" | "saved" | "rejected";

/** The person compares the host key with what the host printed; only a match pairs. */
export function VerifyStep({ offer }: { readonly offer: PairingOffer }) {
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const match = (): void => {
    connectionStore.update({
      ...connectionStore.settings,
      mode: "relay",
      hostId: offer.hostId,
      relayUrl: offer.relayUrl,
    });
    setOutcome("saved");
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-6 py-10">
      <Steps current={2} />
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-balance text-foreground">Check the host's key</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          The host prints the same groups when you run{" "}
          <code className="text-foreground">doriface-host fingerprint</code>.
        </p>
      </div>
      <div className="rounded-lg bg-raised p-4">
        <Fingerprint label="Host key (SHA-256)" value={offer.fingerprint.replaceAll(" ", "")} />
      </div>
      {outcome === "saved" ? (
        <Notice tone="warning" title="Encrypted pairing is not in this build yet">
          The host is saved. The handshake that finishes pairing ships with the encryption package; until then, connect
          over loopback dev in Settings.
        </Notice>
      ) : outcome === "rejected" ? (
        <Notice tone="error" title="Do not pair with this host">
          The key differs from the one your host printed, so this link may not come from it. Run doriface-host pair
          again and use the new link.
        </Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={match}>
            They match
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setOutcome("rejected")}>
            They don't match
          </Button>
        </div>
      )}
      {outcome === "pending" ? null : (
        <Button variant="secondary" size="lg" render={<Link to={outcome === "saved" ? "/settings" : "/"} />}>
          {outcome === "saved" ? "Open settings" : "Back"}
        </Button>
      )}
    </main>
  );
}
