export const SESSION_COOKIE = "mf_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Token format: base64url("<userId>.<expiresAtMs>") + "." + base64url(HMAC) */
export async function signSession(
  userId: number,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowMs: number = Date.now(),
): Promise<string> {
  const payload = `${userId}.${nowMs + ttlSeconds * 1000}`;
  const encoded = b64urlEncode(new TextEncoder().encode(payload));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<number | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sig: Uint8Array;
  try {
    sig = b64urlDecode(sigPart);
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    sig,
    new TextEncoder().encode(encoded),
  );
  if (!ok) return null;

  let payload: string;
  try {
    payload = new TextDecoder().decode(b64urlDecode(encoded));
  } catch {
    return null;
  }

  const [idPart, expPart] = payload.split(".");
  const userId = Number(idPart);
  const expiresAt = Number(expPart);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expiresAt)) return null;
  if (nowMs >= expiresAt) return null;
  return userId;
}
