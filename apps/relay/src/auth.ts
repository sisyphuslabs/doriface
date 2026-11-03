import { AUTH_ANSWER_BYTES, authMessage, hostIdOf, SIGN_PUB_BYTES } from "@doriface/relay-client/wire";

/**
 * Checks a host's `signPub || signature` answer: the key must hash to `hostId` and sign the challenge.
 * Returns the proven signPub, or undefined.
 */
export async function verifyAuthAnswer(
  hostId: string,
  challenge: Uint8Array,
  answer: Uint8Array,
): Promise<Uint8Array | undefined> {
  if (answer.byteLength !== AUTH_ANSWER_BYTES) return undefined;
  const signPub = answer.slice(0, SIGN_PUB_BYTES);
  const signature = answer.slice(SIGN_PUB_BYTES);
  if ((await hostIdOf(signPub)) !== hostId) return undefined;
  // A key that is not a valid Ed25519 point fails import; that is an auth failure like any other.
  const key = await crypto.subtle.importKey("raw", signPub, { name: "Ed25519" }, false, ["verify"]).catch(() => null);
  if (key === null) return undefined;
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, signature, authMessage(hostId, challenge));
  return valid ? signPub : undefined;
}
