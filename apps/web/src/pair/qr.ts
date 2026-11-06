import { encode } from "uqr";

/** The QR matrix a pairing link encodes: dark modules only, with the quiet zone a camera needs around them. */
export function qrModules(text: string): readonly (readonly boolean[])[] {
  return encode(text, { ecc: "L", border: 2 }).data;
}
