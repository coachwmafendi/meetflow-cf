import { Hono } from "hono";
import { dashboardStats, getBookingOwned, listBookings } from "../db/bookings";
import { isoUtc, nowIso } from "../lib/time";
import { zonedDateString, zonedToUtc } from "../lib/timezone";
import { BookingError, cancelOwnedBooking } from "../services/booking";
import { queueBookingCancelled } from "../services/email";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const bookingRoutes = new Hono<AppEnv>();

bookingRoutes.use("*", requireAuth);

bookingRoutes.get("/stats", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const today = zonedDateString(now, user.timezone);
  const dayStart = zonedToUtc(today, "00:00", user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const stats = await dashboardStats(
    c.env.DB,
    user.id,
    isoUtc(now),
    isoUtc(dayStart),
    isoUtc(dayEnd),
  );
  return c.json({ stats });
});

bookingRoutes.get("/", async (c) => {
  const raw = c.req.query("scope") ?? "upcoming";
  const scope = raw === "past" || raw === "cancelled" ? raw : "upcoming";
  const bookings = await listBookings(c.env.DB, c.get("user").id, scope, nowIso());
  return c.json({ bookings, scope });
});

bookingRoutes.get("/:id", async (c) => {
  const booking = await getBookingOwned(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  if (!booking) return c.json({ error: "Not found" }, 404);
  return c.json({ booking });
});

bookingRoutes.post("/:id/cancel", async (c) => {
  try {
    const booking = await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
    c.executionCtx.waitUntil(queueBookingCancelled(c.env, booking.id));
    return c.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
