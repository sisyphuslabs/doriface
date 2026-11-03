import { Button, EmptyState } from "@doriface/ui";
import { Link2Off } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { parsePairingFragment, type PairingOffer } from "../pair/fragment.ts";
import { pairingLink } from "../pair/link-capture.ts";
import { PairStep } from "../pair/pair-step.tsx";
import { VerifyStep } from "../pair/verify-step.tsx";

/** With a captured link (already gone from the URL), verify the host; without, ask for the link or code. */
export function PairRoute() {
  const link = useSyncExternalStore(pairingLink.subscribe, pairingLink.get);
  const [typed, setTyped] = useState<PairingOffer | null>(null);
  if (typed !== null) return <VerifyStep offer={typed} />;
  if (link === null) return <PairStep onOffer={setTyped} />;
  const parsed = parsePairingFragment(link);
  if (parsed.ok) return <VerifyStep key={link} offer={parsed.offer} />;
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
