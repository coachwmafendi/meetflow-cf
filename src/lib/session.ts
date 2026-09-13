import { signPayload, verifyPayload } from "./hmac";

export const SESSION_COOKIE = "mf_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Domain separation: a session token must never be mintable from another flow. */
const PURPOSE = "session";

/** Token payload is `<userId>.<expiresAtMs>`, signed under the session purpose. */
export async function signSession(
  userId: number,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowMs: number = Date.now(),
): Promise<string> {
  return signPayload(PURPOSE, `${userId}.${nowMs + ttlSeconds * 1000}`, secret);
}

export async function verifySession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<number | null> {
  const payload = await verifyPayload(PURPOSE, token, secret);
  if (payload === null) return null;

  const [idPart, expPart] = payload.split(".");
  const userId = Number(idPart);
  const expiresAt = Number(expPart);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expiresAt)) return null;
  if (nowMs >= expiresAt) return null;
  return userId;
}
