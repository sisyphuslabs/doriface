import { Button, EmptyState } from "@doriface/ui";
import { Link2Off } from "lucide-react";
import { useEffect, useState } from "react";
import { parsePairingFragment, type PairingOffer } from "../pair/fragment.ts";
import { PairStep } from "../pair/pair-step.tsx";
import { VerifyStep } from "../pair/verify-step.tsx";

function useHash(): readonly [string] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const sync = (): void => setHash(window.location.hash);
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  return [hash];
}

/** The fragment never reaches a server: with one, verify the host; without, ask for the link. */
export function PairRoute() {
  const [hash] = useHash();
  const [typed, setTyped] = useState<PairingOffer | null>(null);
  if (typed !== null) return <VerifyStep offer={typed} />;
  if (hash === "" || hash === "#") return <PairStep onOffer={setTyped} />;
  const parsed = parsePairingFragment(hash);
  if (parsed.ok) return <VerifyStep offer={parsed.offer} />;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <EmptyState
        icon={<Link2Off />}
        title="This pairing link cannot be used"
        description={`${parsed.reason} Run doriface-host pair again and open the new link.`}
        actions={
          <Button variant="primary" size="lg" render={<a href="/pair" />}>
            Type a pairing code
          </Button>
        }
      />
    </main>
  );
}
