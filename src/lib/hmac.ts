/**
 * Shared HMAC-SHA256 primitives for the app's signed tokens.
 *
 * Every token embeds a purpose string that is signed along with the payload, so
 * a token minted for one use can never be replayed as another — a cancel link
 * must not be usable as a session cookie.
 */

export function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs `payload`, binding it to `purpose`. Returns `<payload>.<signature>`. */
export async function signPayload(
  purpose: string,
  payload: string,
  secret: string,
): Promise<string> {
  const encoded = b64urlEncode(new TextEncoder().encode(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    new TextEncoder().encode(`${purpose}.${encoded}`),
  );
  return `${encoded}.${b64urlEncode(new Uint8Array(signature))}`;
}

/** Returns the payload if the signature matches `purpose`, else null. */
export async function verifyPayload(
  purpose: string,
  token: string,
  secret: string,
): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  let signature: Uint8Array;
  try {
    signature = b64urlDecode(token.slice(dot + 1));
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    signature,
    new TextEncoder().encode(`${purpose}.${encoded}`),
  );
  if (!ok) return null;

  try {
    return new TextDecoder().decode(b64urlDecode(encoded));
  } catch {
    return null;
  }
}
