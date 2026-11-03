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
export { PROTOCOL_NAMES, type Pattern } from "./noise/handshake.ts";
export {
  buildPairingUrl,
  createPairingOffer,
  decodePairingHello,
  DEFAULT_RELAY_URL,
  encodePairingHello,
  generatePairingCode,
  PAIRING_TTL_MS,
  pairingCodeBytes,
  pairingPsk,
  PairingSlot,
  parsePairingUrl,
  type PairingLink,
  type PairingOffer,
  type PairingSlotState,
} from "./pairing.ts";
