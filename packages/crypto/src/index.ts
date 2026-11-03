export { base32Decode, base32Encode, base64urlDecode, base64urlEncode, bytesEqual, concatBytes } from "./encoding.ts";
export {
  ed25519FromSecret,
  fingerprintOf,
  generateEd25519,
  generateHostIdentity,
  generateX25519,
  hostIdentityFromSecrets,
  hostIdOf,
  prologueFor,
  relayChallengeMessage,
  signRelayChallenge,
  verifyRelayAnswer,
  x25519FromSecret,
  type HostIdentity,
  type KeyPair,
} from "./identity.ts";
export {
  CloseCode,
  closeCodeOf,
  SecureLinkError,
  type ByteLink,
  type CloseCodeValue,
  type Unsubscribe,
} from "./link.ts";
export { PROTOCOL_NAMES, type Pattern } from "./noise/handshake.ts";
export {
  buildPairingUrl,
  createPairingOffer,
  decodePairingHello,
  DEFAULT_RELAY_URL,
  encodePairingHello,
  formatPairingCode,
  generatePairingCode,
  MAX_PAIRING_FAILURES,
  normalizePairingCode,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_SLOT_LENGTH,
  PAIRING_TTL_MS,
  pairingPsk,
  pairingSlotOf,
  PairingGuard,
  parsePairingUrl,
  type PairingGuardState,
  type PairingLink,
  type PairingOffer,
} from "./pairing.ts";
export {
  HANDSHAKE_TIMEOUT_MS,
  secureLink,
  type Authorization,
  type ClientHello,
  type InitiatorOptions,
  type ResponderOptions,
  type SecureLinkOptions,
} from "./secure-link.ts";
export type { SecureLink, SessionInfo } from "./secured-link.ts";
export { MAX_PLAINTEXT, REKEY_INTERVAL } from "./transport.ts";
