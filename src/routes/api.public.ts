import { Hono } from "hono";
import { listPublicEventTypes } from "../db/eventTypes";
import { findUserBySlug } from "../db/users";
import { isYmd } from "../lib/validate";
import { getSlotsForDate } from "../services/availability";
import { BookingError, createBooking, resolvePublicTarget } from "../services/booking";
import type { AppEnv } from "../types";

export const publicRoutes = new Hono<AppEnv>();

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
    const slots = await getSlotsForDate(c.env.DB, {
      hostId: host.id,
      hostTimezone: host.timezone,
      eventTypeId: eventType.id,
      durationMinutes: eventType.duration_minutes,
      dateYmd: date,
      nowMs: Date.now(),
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

publicRoutes.post("/:username/:eventSlug/book", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const booking = await createBooking(c.env.DB, {
      hostSlug: c.req.param("username"),
      eventSlug: c.req.param("eventSlug"),
      startAt: String(body.start_at ?? ""),
      guestName: String(body.guest_name ?? ""),
      guestEmail: String(body.guest_email ?? ""),
      guestTimezone: String(body.timezone ?? "UTC"),
      notes: body.notes ? String(body.notes) : null,
    });
    return c.json({ booking }, 201);
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
