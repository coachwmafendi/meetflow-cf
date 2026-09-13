import { Hono } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { dashboardStats, getBookingById, listBookings } from "../db/bookings";
import {
  getEventTypeById,
  getPublicEventType,
  insertEventType,
  listEventTypes,
  listPublicEventTypes,
} from "../db/eventTypes";
import { findUserById, findUserBySlug, updateUserSettings } from "../db/users";
import { toMinutes } from "../lib/slots";
import { isoUtc, nowIso } from "../lib/time";
import { isValidTimeZone, zonedDateString, zonedToUtc } from "../lib/timezone";
import { isEventSlug, isHhmm } from "../lib/validate";
import { clearSession, issueSession } from "../middleware/auth";
import { AuthError, login, register } from "../services/auth";
import { BookingError, cancelOwnedBooking } from "../services/booking";
import { loginPage, registerPage } from "../views/auth";
import {
  availabilityPage,
  bookingsPage,
  dashboardPage,
  eventTypesPage,
  settingsPage,
} from "../views/dashboard";
import { bookingPage, confirmationPage, profilePage } from "../views/publicBooking";
import type { AppEnv } from "../types";

export const pageRoutes = new Hono<AppEnv>();

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const notFound = () =>
  html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found · MeetFlow</title>
     <link rel="stylesheet" href="/app.css"></head>
     <body class="bg-neutral-50 text-ink"><main class="mx-auto max-w-md px-6 py-20 text-center">
     <h1 class="text-2xl font-semibold tracking-tight">Not found</h1>
     <p class="mt-2 text-sm text-muted">That page does not exist.</p>
     </main></body></html>`,
    404,
  );

pageRoutes.get("/", (c) => (c.get("user") ? c.redirect("/dashboard") : c.redirect("/login")));

pageRoutes.get("/login", (c) => (c.get("user") ? c.redirect("/dashboard") : html(loginPage())));
pageRoutes.get("/register", (c) =>
  c.get("user") ? c.redirect("/dashboard") : html(registerPage()),
);

pageRoutes.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const user = await login(c.env.DB, String(form.email ?? ""), String(form.password ?? ""));
  if (!user) return html(loginPage("Invalid email or password"), 401);
  await issueSession(c, user.id);
  return c.redirect("/dashboard", 302);
});

pageRoutes.post("/register", async (c) => {
  const form = await c.req.parseBody();
  try {
    const user = await register(c.env.DB, {
      name: String(form.name ?? ""),
      email: String(form.email ?? ""),
      password: String(form.password ?? ""),
      slug: String(form.slug ?? ""),
      timezone: String(form.timezone ?? "UTC"),
    });
    await issueSession(c, user.id);
    return c.redirect("/dashboard", 302);
  } catch (err) {
    if (err instanceof AuthError) return html(registerPage(err.message), err.status);
    throw err;
  }
});

pageRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.redirect("/login", 302);
});

// --- Host dashboard ---------------------------------------------------------

const dashboard = new Hono<AppEnv>();

dashboard.use("*", async (c, next) => {
  if (!c.get("user")) return c.redirect("/login", 302);
  await next();
});

dashboard.get("/", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const today = zonedDateString(now, user.timezone);
  const dayStart = zonedToUtc(today, "00:00", user.timezone);
  const stats = await dashboardStats(
    c.env.DB,
    user.id,
    isoUtc(now),
    isoUtc(dayStart),
    isoUtc(new Date(dayStart.getTime() + 86_400_000)),
  );
  const recent = (await listBookings(c.env.DB, user.id, "upcoming", nowIso())).slice(0, 5);
  return html(dashboardPage(user, stats, recent));
});

dashboard.get("/event-types", async (c) => {
  const user = c.get("user");
  return html(eventTypesPage(user, await listEventTypes(c.env.DB, user.id)));
});

dashboard.post("/event-types", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const slug = String(form.slug ?? "").toLowerCase();
  const duration = Number(form.duration_minutes);
  if (isEventSlug(slug) && Number.isInteger(duration) && duration >= 5 && duration <= 480) {
    try {
      await insertEventType(c.env.DB, {
        userId: user.id,
        name: String(form.name ?? "").trim(),
        slug,
        description: form.description ? String(form.description).trim() : null,
        durationMinutes: duration,
        now: nowIso(),
      });
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  return c.redirect("/dashboard/event-types", 302);
});

dashboard.get("/availability", async (c) => {
  const user = c.get("user");
  return html(availabilityPage(user, await listRules(c.env.DB, user.id)));
});

dashboard.post("/availability", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody({ all: true });
  const rules: RuleInput[] = [];

  for (let day = 0; day <= 6; day++) {
    const starts = ([] as unknown[]).concat(form[`start_${day}`] ?? []);
    const ends = ([] as unknown[]).concat(form[`end_${day}`] ?? []);
    for (let i = 0; i < starts.length; i++) {
      const start = String(starts[i] ?? "");
      const end = String(ends[i] ?? "");
      if (!start || !end) continue;
      if (!isHhmm(start) || !isHhmm(end)) continue;
      if (toMinutes(start) >= toMinutes(end)) continue;
      rules.push({ dayOfWeek: day, startTime: start, endTime: end });
    }
  }

  await replaceRules(c.env.DB, user.id, rules, nowIso());
  return c.redirect("/dashboard/availability", 302);
});

dashboard.get("/bookings", async (c) => {
  const user = c.get("user");
  const raw = c.req.query("scope") ?? "upcoming";
  const scope = raw === "past" || raw === "cancelled" ? raw : "upcoming";
  const bookings = await listBookings(c.env.DB, user.id, scope, nowIso());
  return html(bookingsPage(user, bookings, scope));
});

dashboard.post("/bookings/:id/cancel", async (c) => {
  try {
    await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;
  }
  return c.redirect("/dashboard/bookings", 302);
});

dashboard.get("/settings", (c) => html(settingsPage(c.get("user"))));

dashboard.post("/settings", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const timezone = String(form.timezone ?? user.timezone);
  const name = String(form.name ?? user.name).trim();
  if (name && isValidTimeZone(timezone)) {
    await updateUserSettings(c.env.DB, user.id, { name, timezone, now: nowIso() });
  }
  return c.redirect("/dashboard/settings", 302);
});

pageRoutes.route("/dashboard", dashboard);

// --- Public -----------------------------------------------------------------

pageRoutes.get("/booking/:id/confirmed", async (c) => {
  const booking = await getBookingById(c.env.DB, Number(c.req.param("id")));
  if (!booking) return notFound();
  const host = await findUserById(c.env.DB, booking.user_id);
  const eventType = await getEventTypeById(c.env.DB, booking.event_type_id);
  if (!host || !eventType) return notFound();
  return html(confirmationPage(host, eventType, booking));
});

pageRoutes.get("/:username", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return notFound();
  return html(profilePage(host, await listPublicEventTypes(c.env.DB, host.id)));
});

pageRoutes.get("/:username/:eventSlug", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return notFound();
  const eventType = await getPublicEventType(
    c.env.DB,
    host.id,
    c.req.param("eventSlug").toLowerCase(),
  );
  if (!eventType) return notFound();
  return html(bookingPage(host, eventType));
});
