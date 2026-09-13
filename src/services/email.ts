import { getBookingById } from "../db/bookings";
import { getEventTypeById } from "../db/eventTypes";
import { findUserById } from "../db/users";
import {
  guestCancellation,
  guestConfirmation,
  guestReminder,
  hostNotification,
  type BookingEmailContext,
} from "../lib/emailTemplates";
import { sendEmail, type SendOutcome } from "../lib/resend";
import { nowIso } from "../lib/time";
import type { Env } from "../types";

/**
 * Email jobs carry only a booking id, never a rendered message.
 *
 * The consumer re-reads from D1 at send time, so a booking cancelled between
 * enqueue and delivery is caught, and a retry can never resend stale details.
 */
export type EmailJob =
  | { kind: "booking_confirmed"; bookingId: number; to: "guest" | "host" }
  | { kind: "booking_cancelled"; bookingId: number; to: "guest" }
  | { kind: "booking_reminder"; bookingId: number; to: "guest" };

/**
 * Queues the emails for a new booking. Never throws: a mail problem must not
 * turn a successful booking into a failed request.
 */
export async function queueBookingCreated(env: Env, bookingId: number): Promise<void> {
  await enqueue(env, [
    { kind: "booking_confirmed", bookingId, to: "guest" },
    { kind: "booking_confirmed", bookingId, to: "host" },
  ]);
}

export async function queueBookingCancelled(env: Env, bookingId: number): Promise<void> {
  await enqueue(env, [{ kind: "booking_cancelled", bookingId, to: "guest" }]);
}

async function enqueue(env: Env, jobs: EmailJob[]): Promise<void> {
  if (!env.EMAIL_QUEUE) return;
  try {
    await env.EMAIL_QUEUE.sendBatch(jobs.map((body) => ({ body })));
  } catch (err) {
    console.error("email: failed to enqueue", err);
  }
}

/** Everything a template needs, or null if the booking no longer qualifies. */
async function loadContext(
  env: Env,
  job: EmailJob,
): Promise<{ ctx: BookingEmailContext; guestTimeZone: string; hostTimeZone: string } | null> {
  const booking = await getBookingById(env.DB, job.bookingId);
  if (!booking) return null;

  // State is re-checked here, not at enqueue time.
  if (job.kind === "booking_cancelled" && booking.status !== "cancelled") return null;
  if (job.kind !== "booking_cancelled" && booking.status !== "confirmed") return null;

  const [host, eventType] = await Promise.all([
    findUserById(env.DB, booking.user_id),
    getEventTypeById(env.DB, booking.event_type_id),
  ]);
  if (!host || !eventType) return null;

  return {
    ctx: {
      guestName: booking.guest_name,
      guestEmail: booking.guest_email,
      hostName: host.name,
      hostEmail: host.email,
      hostSlug: host.slug,
      eventName: eventType.name,
      durationMinutes: eventType.duration_minutes,
      startAt: booking.start_at,
      endAt: booking.end_at,
      notes: booking.notes,
      appUrl: env.APP_URL,
    },
    guestTimeZone: booking.timezone,
    hostTimeZone: host.timezone,
  };
}

/** Renders and sends one job. Exported so tests can drive it without a queue. */
export async function processEmailJob(
  env: Env,
  job: EmailJob,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  const loaded = await loadContext(env, job);
  if (!loaded) {
    return { status: "skipped", reason: `booking ${job.bookingId} no longer needs ${job.kind}` };
  }
  const { ctx, guestTimeZone, hostTimeZone } = loaded;

  const message =
    job.kind === "booking_confirmed"
      ? job.to === "host"
        ? hostNotification(ctx, hostTimeZone)
        : guestConfirmation(ctx, guestTimeZone)
      : job.kind === "booking_cancelled"
        ? guestCancellation(ctx, guestTimeZone)
        : guestReminder(ctx, guestTimeZone);

  return sendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, message, fetchImpl);
}

/**
 * Queue consumer. Only transient failures are retried; a permanent rejection is
 * acked so one bad address cannot block the batch forever.
 */
export async function handleEmailBatch(
  batch: MessageBatch<EmailJob>,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const message of batch.messages) {
    let outcome: SendOutcome;
    try {
      outcome = await processEmailJob(env, message.body, fetchImpl);
    } catch (err) {
      console.error("email: unexpected error", message.body, err);
      message.retry();
      continue;
    }

    if (outcome.status === "retry") {
      console.warn("email: retrying", message.body.kind, outcome.reason);
      message.retry();
      continue;
    }
    if (outcome.status === "failed") {
      console.error("email: giving up", message.body.kind, outcome.reason);
    }
    message.ack();
  }
}

/** How far ahead the hourly sweep looks for meetings needing a reminder. */
const REMINDER_WINDOW_HOURS = 24;

/**
 * Hourly cron sweep: queue a reminder for every confirmed booking starting
 * within the next 24 hours that has not had one.
 *
 * `reminder_sent_at` is stamped in the same statement that selects the rows, so
 * an overlapping run cannot pick up the same booking twice.
 */
export async function queueDueReminders(env: Env, now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 3600_000);
  const stamped = nowIso();

  const { results } = await env.DB.prepare(
    `UPDATE bookings
        SET reminder_sent_at = ?
      WHERE status = 'confirmed'
        AND reminder_sent_at IS NULL
        AND start_at > ?
        AND start_at <= ?
      RETURNING id`,
  )
    .bind(stamped, isoOf(now), isoOf(horizon))
    .all<{ id: number }>();

  if (results.length === 0) return 0;

  await enqueue(
    env,
    results.map((row) => ({ kind: "booking_reminder", bookingId: row.id, to: "guest" }) as const),
  );
  return results.length;
}

function isoOf(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
