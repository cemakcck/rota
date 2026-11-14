const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TRIP_ID_LENGTH = 22; // 62^22 > 2^128, so 16 random bytes always fit
const ID_LENGTH = 12;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** A 128-bit random trip id, base62, always exactly 22 characters. */
export function newTripId(): string {
  let value = 0n;
  for (const byte of randomBytes(16)) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < TRIP_ID_LENGTH; i++) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

export function isTripId(s: unknown): boolean {
  return typeof s === "string" && /^[0-9A-Za-z]{22}$/.test(s);
}

/** A 12-character base62 id for places, days and checklist items. */
export function newId(): string {
  let out = "";
  while (out.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH)) {
      // 248 = 4 * 62: rejecting larger bytes keeps every character equally likely.
      if (byte < 248 && out.length < ID_LENGTH) out += BASE62[byte % 62];
    }
  }
  return out;
}
