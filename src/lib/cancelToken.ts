import { signPayload, verifyPayload } from "./hmac";

/**
 * Signed guest cancellation links.
 *
 * The token *is* the authorisation — there is no guest account to authenticate
 * against — so it is scoped as tightly as possible: it names exactly one
 * booking, and it is signed under its own purpose so it can never be replayed
 * as a session cookie.
 *
 * There is no expiry baked in. Cancelling is idempotent and a booking that is
 * already cancelled or already past is rejected by the service, so an old link
 * grants nothing. Anyone holding the link can cancel that one meeting, which is
 * the accepted trade-off for emailed magic links.
 */
const PURPOSE = "booking-cancel";

export async function signCancelToken(bookingId: number, secret: string): Promise<string> {
  return signPayload(PURPOSE, String(bookingId), secret);
}

/** Returns the booking id the token authorises, or null. */
export async function verifyCancelToken(token: string, secret: string): Promise<number | null> {
  const payload = await verifyPayload(PURPOSE, token, secret);
  if (payload === null) return null;

  const bookingId = Number(payload);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return null;
  return bookingId;
}

/**
 * Same-origin path, for links rendered inside the app. Relative on purpose:
 * an absolute APP_URL would bounce a local or preview visitor to production.
 */
export async function cancelPath(bookingId: number, secret: string): Promise<string> {
  const token = await signCancelToken(bookingId, secret);
  return `/booking/${bookingId}/cancel?token=${encodeURIComponent(token)}`;
}

/** Absolute URL, for emails — which have no origin to be relative to. */
export async function cancelUrl(
  appUrl: string,
  bookingId: number,
  secret: string,
): Promise<string> {
  return `${appUrl}${await cancelPath(bookingId, secret)}`;
}

/** Same-origin path for the reschedule page, alongside the cancel path. */
export async function reschedulePath(bookingId: number, secret: string): Promise<string> {
  const token = await signCancelToken(bookingId, secret);
  return `/booking/${bookingId}/reschedule?token=${encodeURIComponent(token)}`;
}

/** Absolute URL, for emails. */
export async function rescheduleUrl(
  appUrl: string,
  bookingId: number,
  secret: string,
): Promise<string> {
  return `${appUrl}${await reschedulePath(bookingId, secret)}`;
}
