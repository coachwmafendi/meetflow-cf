import { Hono } from "hono";
import type { Context } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { dashboardStats, getBookingById, listBookings } from "../db/bookings";
import {
  countBookingsForEventType,
  deleteEventType,
  getEventTypeById,
  getEventTypeOwned,
  getPublicEventType,
  insertEventType,
  listEventTypes,
  listPublicEventTypes,
  updateEventType,
} from "../db/eventTypes";
import { findUserById, findUserBySlug, setAvatarKey, updateUserSettings } from "../db/users";
import { listSavedLocations } from "../db/savedLocations";
import { ImageError, avatarKey, validateAvatar } from "../lib/image";
import { cancelPath, reschedulePath } from "../lib/cancelToken";
import {
  emailFromIdToken,
  exchangeGoogleCode,
  fetchGoogleBusyClosure,
  googleAuthUrl,
  hasGoogleSecrets,
  verifyOauthState,
} from "../lib/googleCalendar";
import { encryptToBase64 } from "../lib/encrypt";
import {
  deleteGoogleConnection,
  getConnectedGoogleEmail,
  upsertGoogleConnection,
} from "../db/googleConnections";
import { toMinutes } from "../lib/slots";
import { isoUtc, nowIso } from "../lib/time";
import { isValidTimeZone, zonedDateString, zonedToUtc } from "../lib/timezone";
import { isEventSlug, isHhmm, isLocationType, normalizeLocationValue } from "../lib/validate";
import { clearSession, issueSession } from "../middleware/auth";
import { LIMITS, rateLimit } from "../middleware/rateLimit";
import { AuthError, login, register } from "../services/auth";
import {
  BookingError,
  cancelBookingByToken,
  cancelOwnedBooking,
  rescheduleBooking,
  resolveCancelToken,
} from "../services/booking";
import { queueBookingCancelled, queueBookingCreated } from "../services/email";
import { loginPage, registerPage } from "../views/auth";
import { privacyPage, termsPage } from "../views/legal";
import { marketingPage } from "../views/marketing";
import {
  availabilityPage,
  bookingsPage,
  dashboardPage,
  eventTypeEditPage,
  eventTypesPage,
  settingsPage,
  type CalendarSettings,
} from "../views/dashboard";
import {
  bookingPage,
  cancelConfirmPage,
  cancelUnavailablePage,
  cancelledPage,
  confirmationPage,
  profilePage,
} from "../views/publicBooking";
import type { AppEnv, EventTypeRow } from "../types";

export const pageRoutes = new Hono<AppEnv>();

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const notFound = () =>
  html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found · MeetFlow</title>
     <link rel="stylesheet" href="/app.css"></head>
     <body class="bg-canvas text-body"><main class="mx-auto max-w-md px-6 py-20 text-center">
     <h1 class="text-2xl font-semibold tracking-tight">Not found</h1>
     <p class="mt-2 text-sm text-muted">That page does not exist.</p>
     </main></body></html>`,
    404,
  );

const readToast = (c: Context<AppEnv>) => (c.req.query("toast") ?? "").slice(0, 120);

const toastRedirect = (c: Context<AppEnv>, path: string, message?: string) =>
  c.redirect(`${path}${message ? `?toast=${encodeURIComponent(message)}` : ""}`, 302);

/** Feature-off renders no card at all; on renders connect or connected. */
async function calendarSettings(env: Cloudflare.Env, userId: number): Promise<CalendarSettings> {
  if (!hasGoogleSecrets(env)) return { configured: false, googleEmail: null };
  return { configured: true, googleEmail: await getConnectedGoogleEmail(env.DB, userId) };
}

pageRoutes.get("/", (c) => (c.get("user") ? c.redirect("/dashboard") : html(marketingPage())));

pageRoutes.get("/login", (c) => (c.get("user") ? c.redirect("/dashboard") : html(loginPage())));
pageRoutes.get("/register", (c) =>
  c.get("user") ? c.redirect("/dashboard") : html(registerPage()),
);

// Legal pages. Registered before the /:username catch-all so they own their URLs.
pageRoutes.get("/privacy", (c) => html(privacyPage()));
pageRoutes.get("/terms", (c) => html(termsPage()));

/** Renders a throttled form submission as the page again, not as raw JSON. */
function throttled(render: (error: string) => string) {
  return (_c: unknown, retryAfter: number) => {
    const unit = retryAfter === 1 ? "second" : "seconds";
    return html(render(`Too many attempts. Please try again in ${retryAfter} ${unit}.`), 429);
  };
}

const loginLimit = rateLimit({ ...LIMITS.login, onLimited: throttled(loginPage) });
const registerLimit = rateLimit({ ...LIMITS.register, onLimited: throttled(registerPage) });

pageRoutes.post("/login", loginLimit, async (c) => {
  const form = await c.req.parseBody();
  const user = await login(c.env.DB, String(form.email ?? ""), String(form.password ?? ""));
  if (!user) return html(loginPage("Invalid email or password"), 401);
  await issueSession(c, user.id);
  return c.redirect("/dashboard", 302);
});

pageRoutes.post("/register", registerLimit, async (c) => {
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
  return html(dashboardPage(user, stats, recent, readToast(c)));
});

dashboard.get("/event-types", async (c) => {
  const user = c.get("user");
  return html(eventTypesPage(user, await listEventTypes(c.env.DB, user.id), readToast(c)));
});

dashboard.post("/event-types", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const slug = String(form.slug ?? "").toLowerCase();
  const duration = Number(form.duration_minutes);
  const bufferMinutes = Number(form.buffer_minutes);
  const locationType = isLocationType(String(form.location_type ?? ""))
    ? String(form.location_type)
    : "none";
  const locationValue = normalizeLocationValue(locationType, String(form.location_value ?? ""));
  let ok = false;
  if (isEventSlug(slug) && Number.isInteger(duration) && duration >= 5 && duration <= 480) {
    try {
      await insertEventType(c.env.DB, {
        userId: user.id,
        name: String(form.name ?? "").trim(),
        slug,
        description: form.description ? String(form.description).trim() : null,
        durationMinutes: duration,
        bufferMinutes:
          Number.isInteger(bufferMinutes) && bufferMinutes >= 0 && bufferMinutes <= 120
            ? bufferMinutes
            : 0,
        locationType,
        locationValue: locationType === "none" ? null : locationValue,
        now: nowIso(),
      });
      ok = true;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  return ok
    ? toastRedirect(c, "/dashboard/event-types", "Event type created")
    : c.redirect("/dashboard/event-types", 302);
});

dashboard.get("/event-types/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const eventType = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!eventType) return notFound();
  const bookings = await countBookingsForEventType(c.env.DB, id);
  const savedLocations =
    eventType.location_type === "google_meet" || eventType.location_type === "zoom"
      ? (await listSavedLocations(c.env.DB, user.id, eventType.location_type)).map(
          (r) => r.location_value,
        )
      : [];
  return html(
    eventTypeEditPage(user, eventType, bookings, undefined, readToast(c), savedLocations),
  );
});

dashboard.post("/event-types/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return notFound();

  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const slug = String(form.slug ?? "").toLowerCase();
  const duration = Number(form.duration_minutes);
  const bufferMinutes = Number(form.buffer_minutes);
  const locationType = isLocationType(String(form.location_type ?? ""))
    ? String(form.location_type)
    : "none";
  const savedChoice = String(form.saved_location_value ?? "");
  const locationValue = normalizeLocationValue(
    locationType,
    savedChoice && savedChoice !== "__custom__" ? savedChoice : String(form.location_value ?? ""),
  );
  const bookings = await countBookingsForEventType(c.env.DB, id);

  // Re-render with what the host typed, so a validation error never wipes
  // the form. Unparseable values fall back to the stored row.
  const draft: EventTypeRow = {
    ...current,
    name: name || current.name,
    slug: slug || current.slug,
    duration_minutes: Number.isInteger(duration) ? duration : current.duration_minutes,
    buffer_minutes: Number.isInteger(bufferMinutes) ? bufferMinutes : current.buffer_minutes,
    description:
      form.description !== undefined ? String(form.description).trim() : current.description,
    location_type: locationType,
    location_value: locationValue ?? "",
  };

  const invalid =
    !name || name.length > 100
      ? "Name is required."
      : !isEventSlug(slug)
        ? "URL slug must be lowercase letters, digits and dashes."
        : !Number.isInteger(duration) || duration < 5 || duration > 480
          ? "Duration must be between 5 and 480 minutes."
          : form.buffer_minutes !== undefined &&
              (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120)
            ? "Buffer must be between 0 and 120 minutes."
            : locationType !== "none" && !locationValue
              ? "Location needs an address, link or number."
              : null;
  if (invalid) return html(eventTypeEditPage(user, draft, bookings, invalid), 400);

  try {
    await updateEventType(c.env.DB, id, user.id, {
      name,
      slug,
      description: form.description ? String(form.description).trim() : null,
      durationMinutes: duration,
      bufferMinutes: Number.isInteger(bufferMinutes) ? bufferMinutes : current.buffer_minutes,
      locationType,
      locationValue: locationType === "none" ? null : locationValue,
      isActive: current.is_active,
      now: nowIso(),
    });
  } catch (err) {
    if (!String(err).includes("UNIQUE")) throw err;
    return html(
      eventTypeEditPage(user, draft, bookings, "You already have an event type with that URL."),
      409,
    );
  }
  return toastRedirect(c, "/dashboard/event-types", "Changes saved");
});

dashboard.post("/event-types/:id/toggle", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return notFound();

  const nextActive = current.is_active === 1 ? 0 : 1;
  await updateEventType(c.env.DB, id, user.id, {
    name: current.name,
    slug: current.slug,
    description: current.description,
    durationMinutes: current.duration_minutes,
    bufferMinutes: current.buffer_minutes,
    locationType: current.location_type,
    locationValue: current.location_value,
    isActive: nextActive,
    now: nowIso(),
  });
  // The card switch on the list page toggles in place via fetch; the no-JS
  // fallback keeps the redirect + toast flow.
  if ((c.req.header("accept") ?? "").includes("application/json")) {
    return c.json({ is_active: nextActive });
  }
  return toastRedirect(
    c,
    `/dashboard/event-types/${id}`,
    current.is_active === 1 ? "Event type deactivated" : "Event type activated",
  );
});

dashboard.post("/event-types/:id/delete", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return notFound();

  // ERD.md §12: bookings must keep their event name, so a type with history is
  // deactivated instead of removed.
  if ((await countBookingsForEventType(c.env.DB, id)) > 0) {
    await updateEventType(c.env.DB, id, user.id, {
      name: current.name,
      slug: current.slug,
      description: current.description,
      durationMinutes: current.duration_minutes,
      bufferMinutes: current.buffer_minutes,
      locationType: current.location_type,
      locationValue: current.location_value,
      isActive: 0,
      now: nowIso(),
    });
    return toastRedirect(c, "/dashboard/event-types", "Event type deactivated");
  } else {
    await deleteEventType(c.env.DB, id, user.id);
    return toastRedirect(c, "/dashboard/event-types", "Event type deleted");
  }
});

dashboard.post("/event-types/:id/clone", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return notFound();

  const baseSlug = `${current.slug}-copy`;
  const name = `${current.name.slice(0, 92)} (copy)`;
  const now = nowIso();
  let cloned = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      await insertEventType(c.env.DB, {
        userId: user.id,
        name,
        slug: candidate,
        description: current.description,
        durationMinutes: current.duration_minutes,
        bufferMinutes: current.buffer_minutes,
        locationType: current.location_type,
        locationValue: current.location_value,
        now,
      });
      cloned = true;
      break;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  return toastRedirect(
    c,
    "/dashboard/event-types",
    cloned ? "Event type cloned" : "Could not clone event type",
  );
});

dashboard.get("/availability", async (c) => {
  const user = c.get("user");
  return html(availabilityPage(user, await listRules(c.env.DB, user.id), readToast(c)));
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
  return toastRedirect(c, "/dashboard/availability", "Availability saved");
});

dashboard.get("/bookings", async (c) => {
  const user = c.get("user");
  const raw = c.req.query("scope") ?? "upcoming";
  const scope = raw === "past" || raw === "cancelled" ? raw : "upcoming";
  const bookings = await listBookings(c.env.DB, user.id, scope, nowIso());
  return html(bookingsPage(user, bookings, scope, readToast(c)));
});

dashboard.post("/bookings/:id/cancel", async (c) => {
  try {
    const booking = await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
    c.executionCtx.waitUntil(queueBookingCancelled(c.env, booking.id));
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;
  }
  return toastRedirect(c, "/dashboard/bookings", "Appointment cancelled");
});

dashboard.get("/settings", async (c) => {
  const user = c.get("user");
  return html(settingsPage(user, undefined, readToast(c), await calendarSettings(c.env, user.id)));
});

dashboard.post("/settings/avatar", rateLimit(LIMITS.avatar), async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();

  try {
    const { bytes, format } = await validateAvatar(form.avatar);
    const key = avatarKey(user.id, format);

    await c.env.AVATARS.put(key, bytes, {
      httpMetadata: { contentType: format, cacheControl: "public, max-age=31536000, immutable" },
      // Lets us prove ownership when serving, independently of the database.
      customMetadata: { userId: String(user.id) },
    });
    await setAvatarKey(c.env.DB, user.id, key, nowIso());

    // Best-effort cleanup of the replaced object; a leftover costs a few KB.
    if (user.avatar_key && user.avatar_key !== key) {
      c.executionCtx.waitUntil(c.env.AVATARS.delete(user.avatar_key));
    }
  } catch (err) {
    if (err instanceof ImageError) {
      return html(settingsPage(user, err.message, "", await calendarSettings(c.env, user.id)), 400);
    }
    throw err;
  }
  return toastRedirect(c, "/dashboard/settings", "Profile photo updated");
});

dashboard.post("/settings/avatar/remove", async (c) => {
  const user = c.get("user");
  if (user.avatar_key) {
    await setAvatarKey(c.env.DB, user.id, null, nowIso());
    c.executionCtx.waitUntil(c.env.AVATARS.delete(user.avatar_key));
  }
  return toastRedirect(c, "/dashboard/settings", "Profile photo removed");
});

dashboard.post("/settings", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const timezone = String(form.timezone ?? user.timezone);
  const name = String(form.name ?? user.name).trim();
  if (name && isValidTimeZone(timezone)) {
    await updateUserSettings(c.env.DB, user.id, { name, timezone, now: nowIso() });
  }
  return toastRedirect(c, "/dashboard/settings", "Settings saved");
});

dashboard.post("/settings/calendar/disconnect", async (c) => {
  await deleteGoogleConnection(c.env.DB, c.get("user").id);
  return toastRedirect(c, "/dashboard/settings", "Google Calendar disconnected");
});

pageRoutes.route("/dashboard", dashboard);

// --- Public -----------------------------------------------------------------

/**
 * Serves avatars from R2 rather than exposing the bucket publicly, so the
 * Content-Type is the one we sniffed at upload time and can never be inferred
 * from the object. nosniff plus a sandboxing CSP means that even if a crafted
 * file slipped past validation, a browser will not execute it from our origin.
 */
pageRoutes.get("/avatars/:userId/:file", async (c) => {
  const key = `avatars/${c.req.param("userId")}/${c.req.param("file")}`;
  const object = await c.env.AVATARS.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");

  if (c.req.header("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
});

/**
 * Guest cancellation via signed link.
 *
 * GET only *shows* the confirmation — mail scanners and link prefetchers follow
 * GETs, and would otherwise silently cancel people's meetings. The cancellation
 * itself is the POST below.
 */
pageRoutes.get("/booking/:id/cancel", rateLimit(LIMITS.guestCancel), async (c) => {
  const token = c.req.query("token") ?? "";
  try {
    const { booking, host, eventType } = await resolveCancelToken(
      c.env.DB,
      Number(c.req.param("id")),
      token,
      c.env.SESSION_SECRET,
    );
    if (booking.status === "cancelled") return html(cancelledPage(host, eventType));
    if (Date.parse(booking.end_at) <= Date.now()) {
      return html(cancelUnavailablePage("This meeting has already taken place."), 409);
    }
    return html(cancelConfirmPage(host, eventType, booking, token));
  } catch (err) {
    if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
    throw err;
  }
});

pageRoutes.post("/booking/:id/cancel", rateLimit(LIMITS.guestCancel), async (c) => {
  const form = await c.req.parseBody();
  const token = String(form.token ?? "");
  try {
    const { booking, host, eventType } = await cancelBookingByToken(
      c.env.DB,
      Number(c.req.param("id")),
      token,
      c.env.SESSION_SECRET,
    );
    // The guest already knows; the host is the one who needs telling.
    c.executionCtx.waitUntil(queueBookingCancelled(c.env, booking.id, "guest"));
    return html(cancelledPage(host, eventType));
  } catch (err) {
    if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
    throw err;
  }
});

pageRoutes.get("/booking/:id/reschedule", rateLimit(LIMITS.guestCancel), async (c) => {
  const token = c.req.query("token") ?? "";
  try {
    const { booking, host, eventType } = await resolveCancelToken(
      c.env.DB,
      Number(c.req.param("id")),
      token,
      c.env.SESSION_SECRET,
    );
    if (booking.status !== "confirmed") {
      return html(cancelUnavailablePage("This booking can no longer be rescheduled."), 409);
    }
    if (Date.parse(booking.end_at) <= Date.now()) {
      return html(cancelUnavailablePage("This meeting has already taken place."), 409);
    }
    return html(
      bookingPage(host, eventType, {
        bookingId: booking.id,
        token,
        oldStartAt: booking.start_at,
      }),
    );
  } catch (err) {
    if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
    throw err;
  }
});

pageRoutes.post("/booking/:id/reschedule", rateLimit(LIMITS.guestCancel), async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  try {
    const result = await rescheduleBooking(c.env.DB, {
      bookingId: Number(c.req.param("id")),
      token: String(body.token ?? ""),
      secret: c.env.SESSION_SECRET,
      newStartAt: String(body.start_at ?? ""),
      guestTimezone: String(body.timezone ?? "UTC"),
      fetchGoogleBusy: fetchGoogleBusyClosure(c.env.DB, c.env),
    });
    c.executionCtx.waitUntil(queueBookingCreated(c.env, result.booking.id));
    return c.json({ booking: result.booking }, 201);
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

pageRoutes.get("/booking/:id/confirmed", async (c) => {
  const booking = await getBookingById(c.env.DB, Number(c.req.param("id")));
  if (!booking) return notFound();
  const host = await findUserById(c.env.DB, booking.user_id);
  const eventType = await getEventTypeById(c.env.DB, booking.event_type_id);
  if (!host || !eventType) return notFound();
  const href =
    booking.status === "confirmed" ? await cancelPath(booking.id, c.env.SESSION_SECRET) : undefined;
  const reschedule =
    booking.status === "confirmed"
      ? await reschedulePath(booking.id, c.env.SESSION_SECRET)
      : undefined;
  return html(confirmationPage(host, eventType, booking, href, reschedule));
});

pageRoutes.get("/oauth/google/authorize", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (!hasGoogleSecrets(c.env)) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar is not configured");
  }
  return c.redirect(await googleAuthUrl(c.env, user.id, c.env.SESSION_SECRET));
});

pageRoutes.get("/oauth/google/callback", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (!hasGoogleSecrets(c.env)) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar is not configured");
  }
  if (c.req.query("error")) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar connection was cancelled");
  }
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const stateUserId = await verifyOauthState(state, c.env.SESSION_SECRET);
  if (!code || stateUserId !== user.id) {
    return toastRedirect(
      c,
      "/dashboard/settings",
      "Google Calendar connection could not be verified",
    );
  }

  try {
    const tokens = await exchangeGoogleCode(c.env, code);
    if (!tokens.refresh_token) {
      return toastRedirect(
        c,
        "/dashboard/settings",
        "Google did not return a refresh token; reconnect",
      );
    }
    await upsertGoogleConnection(c.env.DB, {
      userId: user.id,
      // "primary" still works as the freeBusy calendar id if the email is unreadable.
      googleEmail: (tokens.id_token ? emailFromIdToken(tokens.id_token) : null) ?? "primary",
      encRefresh: await encryptToBase64(c.env.GOOGLE_TOKEN_KEY!, tokens.refresh_token),
      encAccess: await encryptToBase64(c.env.GOOGLE_TOKEN_KEY!, tokens.access_token),
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
      now: nowIso(),
    });
  } catch (err) {
    console.error("google oauth: callback failed", err);
    return toastRedirect(c, "/dashboard/settings", "Google Calendar connection failed");
  }
  return toastRedirect(c, "/dashboard/settings", "Google Calendar connected");
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
