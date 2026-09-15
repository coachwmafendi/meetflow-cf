/**
 * AES-GCM encryption for Google OAuth tokens at rest in D1.
 *
 * Key: the GOOGLE_TOKEN_KEY secret — base64 of 32 random bytes
 * (`openssl rand -base64 32`). Blob format: plain base64 of
 * <12-byte nonce><ciphertext+GCM tag>, stored in one TEXT column.
 */

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error("GOOGLE_TOKEN_KEY must be base64 of 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToBase64(keyBase64: string, plaintext: string): Promise<string> {
  const key = await importKey(keyBase64);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const blob = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  blob.set(nonce);
  blob.set(ciphertext, NONCE_BYTES);
  return toBase64(blob);
}

export async function decryptFromBase64(keyBase64: string, blobBase64: string): Promise<string> {
  const blob = fromBase64(blobBase64);
  if (blob.byteLength <= NONCE_BYTES) throw new Error("Encrypted blob is too short");
  const key = await importKey(keyBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, NONCE_BYTES) },
    key,
    blob.slice(NONCE_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}