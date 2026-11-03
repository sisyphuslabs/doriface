import { type CipherState, MAX_MESSAGE, TAG_LENGTH } from "./noise/cipher-state.ts";

/** The largest plaintext one Noise transport message carries: 65535 minus the 16-byte tag. */
export const MAX_PLAINTEXT = MAX_MESSAGE - TAG_LENGTH;
/** Messages per direction between two `REKEY()`s. */
export const REKEY_INTERVAL = 2 ** 20;

const EMPTY = new Uint8Array(0);

/** The record layer: one Noise transport message per record, plaintext chunked to {@link MAX_PLAINTEXT}. */
export class Transport {
  readonly #send: CipherState;
  readonly #receive: CipherState;

  constructor(send: CipherState, receive: CipherState) {
    this.#send = send;
    this.#receive = receive;
  }

  /** Encrypts a stream write as one record per {@link MAX_PLAINTEXT} bytes; an empty write is one empty record. */
  seal(plaintext: Uint8Array): Uint8Array[] {
    const records: Uint8Array[] = [];
    let offset = 0;
    do {
      const chunk = plaintext.subarray(offset, offset + MAX_PLAINTEXT);
      records.push(this.#send.encryptWithAd(EMPTY, chunk));
      offset += MAX_PLAINTEXT;
    } while (offset < plaintext.byteLength);
    return records;
  }

  /** Decrypts the next record: RangeError when oversized, DecryptError when tampered, replayed or reordered. */
  open(record: Uint8Array): Uint8Array {
    if (record.byteLength > MAX_MESSAGE) throw new RangeError("record exceeds 65535 bytes");
    return this.#receive.decryptWithAd(EMPTY, record);
  }
}
