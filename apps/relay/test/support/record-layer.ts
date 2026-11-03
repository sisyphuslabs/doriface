/**
 * Whether relay sessions in the end-to-end test run inside the E2EE record layer. `@doriface/crypto` (secureLink) is
 * not on dev yet, so the test carries plaintext links and this is false. When it lands: wrap the uplink's session
 * link (responder) and the client link (initiator) with secureLink in e2e.test.ts and set this to true; the capture
 * assertion then proves the relay never sees the typed text. Lead: re-run `bun test apps/relay/test/e2e.test.ts`.
 */
export const ENCRYPTED = false;
