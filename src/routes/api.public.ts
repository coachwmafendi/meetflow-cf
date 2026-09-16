import { Hono } from "hono";
import { listPublicEventTypes } from "../db/eventTypes";
import { findUserBySlug } from "../db/users";
import { isYmd } from "../lib/validate";
import { zonedToUtc } from "../lib/timezone";
import { fetchGoogleBusyClosure, getGoogleBusy } from "../lib/googleCalendar";
import { LIMITS, rateLimit } from "../middleware/rateLimit";
import { getMonthFreeDays, getSlotsForDate } from "../services/availability";
import { BookingError, createBooking, resolvePublicTarget } from "../services/booking";
import { queueAttendeeJoined, queueBookingCreated } from "../services/email";
import type { AppEnv } from "../types";

export const publicRoutes = new Hono<AppEnv>();

const pad2 = (n: number) => String(n).padStart(2, "0");

publicRoutes.get("/:username", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return c.json({ error: "Not found" }, 404);
  const eventTypes = await listPublicEventTypes(c.env.DB, host.id);
  return c.json({ host, eventTypes });
});

publicRoutes.get("/:username/:eventSlug", async (c) => {
  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    return c.json({ host, eventType });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

publicRoutes.get("/:username/:eventSlug/slots", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!isYmd(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);

  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    const dayStart = zonedToUtc(date, "00:00", host.timezone);
    const extraBusy = await getGoogleBusy(
      c.env.DB,
      c.env,
      host.id,
      dayStart.getTime() - 3_600_000,
      dayStart.getTime() + 25 * 3_600_000,
    );
    const slots = await getSlotsForDate(c.env.DB, {
      hostId: host.id,
      hostTimezone: host.timezone,
      eventTypeId: eventType.id,
      durationMinutes: eventType.duration_minutes,
      bufferMinutes: eventType.buffer_minutes,
      seatsTotal: eventType.seats_total,
      datesOnly: eventType.dates_only,
      dateYmd: date,
      nowMs: Date.now(),
      extraBusy,
    });
    return c.json({
      hostTimezone: host.timezone,
      durationMinutes: eventType.duration_minutes,
      slots,
    });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

publicRoutes.get("/:username/:eventSlug/month", async (c) => {
  const year = Number(c.req.query("year"));
  const month = Number(c.req.query("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return c.json({ error: "year must be a 4-digit year" }, 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ error: "month must be 1-12" }, 400);
  }

  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    const monthStart = zonedToUtc(`${year}-${pad2(month)}-01`, "00:00", host.timezone);
    const extraBusy = await getGoogleBusy(
      c.env.DB,
      c.env,
      host.id,
      monthStart.getTime() - 24 * 3_600_000,
      monthStart.getTime() + 32 * 24 * 3_600_000,
    );
    const days = await getMonthFreeDays(c.env.DB, {
      hostId: host.id,
      hostTimezone: host.timezone,
      eventTypeId: eventType.id,
      durationMinutes: eventType.duration_minutes,
      bufferMinutes: eventType.buffer_minutes,
      seatsTotal: eventType.seats_total,
      datesOnly: eventType.dates_only,
      year,
      month,
      nowMs: Date.now(),
      extraBusy,
    });
    return c.json({ days });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

publicRoutes.post("/:username/:eventSlug/book", rateLimit(LIMITS.book), async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  try {
    const result = await createBooking(c.env.DB, {
      hostSlug: c.req.param("username"),
      eventSlug: c.req.param("eventSlug"),
      startAt: String(body.start_at ?? ""),
      guestName: String(body.guest_name ?? ""),
      guestEmail: String(body.guest_email ?? ""),
      guestTimezone: String(body.timezone ?? "UTC"),
      notes: body.notes ? String(body.notes) : null,
      fetchGoogleBusy: fetchGoogleBusyClosure(c.env.DB, c.env),
    });
    // Off the critical path: the guest gets their confirmation page regardless.
    if (result.attendee) {
      c.executionCtx.waitUntil(queueAttendeeJoined(c.env, result.booking.id, result.attendee.id));
    } else {
      c.executionCtx.waitUntil(queueBookingCreated(c.env, result.booking.id));
    }
    return c.json(
      {
        booking: result.booking,
        ...(result.attendee ? { attendee: result.attendee } : {}),
      },
      201,
    );
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
