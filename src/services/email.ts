import { getBookingById } from "../db/bookings";
import { getEventTypeById } from "../db/eventTypes";
import { findUserById } from "../db/users";
import {
  guestCancellation,
  guestConfirmation,
  hostCancellation,
  guestReminder,
  hostNotification,
  type BookingEmailContext,
} from "../lib/emailTemplates";
import { attendeeCancelUrl, cancelUrl, rescheduleUrl } from "../lib/cancelToken";
import { countConfirmedAttendees, getAttendeeById } from "../db/attendees";
import { sendEmail, type SendOutcome } from "../lib/resend";
import { buildIcs } from "../lib/ics";
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
  | { kind: "attendee_confirmed"; bookingId: number; to: "guest" | "host"; attendeeId: number }
  | { kind: "attendee_cancelled"; bookingId: number; to: "host"; attendeeId: number }
  | { kind: "booking_cancelled"; bookingId: number; to: "guest" | "host" }
  | { kind: "booking_reminder"; bookingId: number; to: "guest"; attendeeId?: number };

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

/** A guest released their seat: only the host needs telling. */
export async function queueAttendeeCancelled(
  env: Env,
  bookingId: number,
  attendeeId: number,
): Promise<void> {
  await enqueue(env, [{ kind: "attendee_cancelled", bookingId, to: "host", attendeeId }]);
}

/** A guest took a seat on a group slot: their confirmation + host headcount. */
export async function queueAttendeeJoined(
  env: Env,
  bookingId: number,
  attendeeId: number,
): Promise<void> {
  await enqueue(env, [
    { kind: "attendee_confirmed", bookingId, to: "guest", attendeeId },
    { kind: "attendee_confirmed", bookingId, to: "host", attendeeId },
  ]);
}

/**
 * `cancelledBy` decides who needs telling: the party who did not press the
 * button. A guest who cancels already knows; their host does not.
 */
export async function queueBookingCancelled(
  env: Env,
  bookingId: number,
  cancelledBy: "host" | "guest" = "host",
): Promise<void> {
  await enqueue(env, [
    { kind: "booking_cancelled", bookingId, to: cancelledBy === "host" ? "guest" : "host" },
  ]);
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

  // Group slots: the job may address one seat rather than the first guest.
  const isGroup = eventType.seats_total > 1;
  let guestName = booking.guest_name;
  let guestEmail = booking.guest_email;
  let guestNotes = booking.notes;
  let guestTimezone = booking.timezone;
  let ticketCode: string | undefined;
  if ("attendeeId" in job && job.attendeeId) {
    const attendee = await getAttendeeById(env.DB, job.attendeeId);
    if (!attendee) return null;
    if (job.kind === "attendee_confirmed" && attendee.status !== "confirmed") return null;
    guestName = attendee.guest_name;
    guestEmail = attendee.guest_email;
    guestNotes = attendee.notes;
    guestTimezone = attendee.timezone;
    ticketCode = attendee.ticket_code ?? undefined;
  }

  const seatsTaken = isGroup ? await countConfirmedAttendees(env.DB, booking.id) : undefined;

  return {
    ctx: {
      guestName,
      guestEmail,
      hostName: host.name,
      hostEmail: host.email,
      hostSlug: host.slug,
      bookingId: booking.id,
      eventName: eventType.name,
      durationMinutes: eventType.duration_minutes,
      datesOnly: eventType.dates_only === 1,
      location: eventType.location_value ?? undefined,
      startAt: booking.start_at,
      endAt: booking.end_at,
      notes: guestNotes,
      appUrl: env.APP_URL,
      ...(isGroup ? { seatsTaken, seatsTotal: eventType.seats_total } : {}),
      ticketCode,
      // Only guest-facing mail carries the link; the host cancels from the dashboard.
      cancelUrl:
        job.to === "guest" && job.kind !== "booking_cancelled"
          ? "attendeeId" in job && job.attendeeId
            ? await attendeeCancelUrl(env.APP_URL, booking.id, job.attendeeId, env.SESSION_SECRET)
            : await cancelUrl(env.APP_URL, booking.id, env.SESSION_SECRET)
          : undefined,
      // Reschedule is only offered in the confirmation of private bookings.
      rescheduleUrl:
        job.to === "guest" && job.kind === "booking_confirmed" && !isGroup
          ? await rescheduleUrl(env.APP_URL, booking.id, env.SESSION_SECRET)
          : undefined,
    },
    guestTimeZone: guestTimezone,
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
    job.kind === "booking_confirmed" || job.kind === "attendee_confirmed"
      ? job.to === "host"
        ? hostNotification(ctx, hostTimeZone)
        : guestConfirmation(ctx, guestTimeZone)
      : job.kind === "booking_cancelled"
        ? job.to === "host"
          ? hostCancellation(ctx, hostTimeZone)
          : guestCancellation(ctx, guestTimeZone)
        : job.kind === "attendee_cancelled"
          ? hostCancellation(ctx, hostTimeZone)
          : guestReminder(ctx, guestTimeZone);

  return sendEmail(
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
    {
      ...message,
      // Guest confirmations for confirmed bookings ride with a calendar file.
      ...(guestConfirms(job) ? { attachments: [calendarInvite(ctx, message.to)] } : {}),
    },
    fetchImpl,
  );
}

/** Only the two guest-facing confirmations carry the .ics. */
function guestConfirms(job: EmailJob): boolean {
  return (
    (job.kind === "booking_confirmed" || job.kind === "attendee_confirmed") && job.to === "guest"
  );
}

function calendarInvite(
  ctx: BookingEmailContext & { location?: string },
  guestEmail: string,
): { filename: string; content: string } {
  const ics = buildIcs({
    uid: `booking-${ctx.bookingId}@meetflow`,
    startAt: ctx.startAt,
    endAt: ctx.endAt,
    summary: `${ctx.eventName} with ${ctx.hostName}`,
    description: [
      ctx.ticketCode ? `Your ticket: ${ctx.ticketCode}` : null,
      ctx.location ? `Location: ${ctx.location}` : null,
      `Guest: ${guestEmail}`,
    ]
      .filter(Boolean)
      .join("\n"),
    location: ctx.location,
    organizerName: ctx.hostName,
  });
  return { filename: "invite.ics", content: btoa(unescape(encodeURIComponent(ics))) };
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

  // Group slots remind every confirmed guest, not just the first one.
  const jobs: EmailJob[] = [];
  for (const row of results) {
    const { results: attendees } = await env.DB.prepare(
      `SELECT id FROM booking_attendees WHERE booking_id = ? AND status = 'confirmed'`,
    )
      .bind(row.id)
      .all<{ id: number }>();
    if (attendees.length > 0) {
      for (const a of attendees) {
        jobs.push({ kind: "booking_reminder", bookingId: row.id, to: "guest", attendeeId: a.id });
      }
    } else {
      jobs.push({ kind: "booking_reminder", bookingId: row.id, to: "guest" });
    }
  }
  await enqueue(env, jobs);
  return results.length;
}

function isoOf(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
