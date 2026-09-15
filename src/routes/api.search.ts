import { Hono } from "hono";
import { recentBookings, searchAttendees, searchBookings, searchEventTypes } from "../db/search";
import { requireAuth } from "../middleware/auth";
import { LIMITS, rateLimit } from "../middleware/rateLimit";
import type { AppEnv } from "../types";

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.use("*", requireAuth);

searchRoutes.get("/", rateLimit(LIMITS.search), async (c) => {
  const raw = c.req.query("q") ?? "";
  if (raw.length > 100) return c.json({ error: "Query too long" }, 400);
  const q = raw.trim();
  const user = c.get("user");

  if (q === "") {
    return c.json({
      bookings: await recentBookings(c.env.DB, user.id),
      eventTypes: [],
      attendees: [],
    });
  }

  const [bookings, eventTypes, attendees] = await Promise.all([
    searchBookings(c.env.DB, user.id, q),
    searchEventTypes(c.env.DB, user.id, q),
    searchAttendees(c.env.DB, user.id, q),
  ]);
  return c.json({ bookings, eventTypes, attendees });
});
