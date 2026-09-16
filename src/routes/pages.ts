import { Hono } from "hono";
import type { Context } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { listEventDates, replaceEventDates } from "../db/eventDates";
import { sendEmail } from "../lib/resend";
import {
  dashboardStats,
  getBookingById,
  getBookingOwned,
  listBookings,
  listConfirmedBetween,
  listConfirmedBookingsForEventType,
} from "../db/bookings";
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
import {
  ImageError,
  avatarKey,
  eventImageKey,
  validateAvatar,
  validateEventImage,
} from "../lib/image";
import { attendeeCancelPath, cancelPath, reschedulePath } from "../lib/cancelToken";
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
import {
  isEventDateRow,
  isEventSlug,
  isHhmm,
  isLocationType,
  normalizeLocationValue,
} from "../lib/validate";
import { clearSession, issueSession } from "../middleware/auth";
import { LIMITS, rateLimit, rateLimitIfNeeded } from "../middleware/rateLimit";
import { AuthError, createPasswordReset, login, register, resetPassword } from "../services/auth";
import {
  BookingError,
  cancelAttendeeSeat,
  cancelBookingByToken,
  cancelOwnedBooking,
  rescheduleBooking,
  resolveCancelToken,
  resolveSeatToken,
} from "../services/booking";
import {
  countConfirmedAttendees,
  getAttendeeForBooking,
  listAttendees,
  listAttendeesForEventType,
  setAttendeeCheckIn,
} from "../db/attendees";
import {
  queueAttendeeCancelled,
  queueBookingCancelled,
  queueBookingCreated,
} from "../services/email";
import { forgotPasswordPage, loginPage, registerPage, resetPasswordPage } from "../views/auth";
import { privacyPage, termsPage } from "../views/legal";
import { marketingPage } from "../views/marketing";
import {
  availabilityPage,
  doorModePage,
  eventTicketsPage,
  type TicketManagerData,
  type TicketManagerGuest,
  type TicketManagerSession,
  bookingsPage,
  dashboardPage,
  eventTypeCreatePage,
  eventTypeEditPage,
  eventTypesPage,
  settingsPage,
  type CalendarSettings,
} from "../views/dashboard";
import {
  bookingPage,
  cancelConfirmPage,
  cancelSeatConfirmPage,
  cancelUnavailablePage,
  cancelledPage,
  confirmationPage,
  profilePage,
  seatCancelledPage,
} from "../views/publicBooking";
import type { AppEnv, BookingAttendeeRow, EventTypeRow } from "../types";

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

/* ------------------------- Password reset -------------------------------- */

const forgotLimit = rateLimit({ ...LIMITS.login, onLimited: throttled(forgotPasswordPage) });

pageRoutes.get("/forgot-password", (c) =>
  c.get("user") ? c.redirect("/dashboard") : html(forgotPasswordPage()),
);

pageRoutes.post("/forgot-password", forgotLimit, async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email ?? "");
  const token = await createPasswordReset(c.env.DB, email);
  if (token) {
    const resetUrl = `${c.env.APP_URL}/reset-password?token=${token}`;
    // Direct send: reset mail cannot wait for the booking queue.
    await sendEmail(
      { apiKey: c.env.RESEND_API_KEY, from: c.env.EMAIL_FROM },
      {
        to: email.trim().toLowerCase(),
        subject: "Reset your MeetFlow password",
        html: `<p>We received a request to reset your MeetFlow password.</p>
               <p><a href="${resetUrl}">Choose a new password</a></p>
               <p>The link works for one hour and can be used once. If it was not you, ignore this email.</p>`,
        text: `Reset your MeetFlow password: ${resetUrl}\n\nThe link works for one hour and can be used once. If it was not you, ignore this email.`,
      },
    );
  }
  // Same response either way, so the form cannot probe which emails exist.
  return toastRedirect(c, "/login", "If that email has an account, a reset link is on its way");
});

pageRoutes.get("/reset-password", (c) => {
  if (c.get("user")) return c.redirect("/dashboard");
  const token = c.req.query("token") ?? "";
  if (!token) return html(forgotPasswordPage("This reset link is missing its token."), 400);
  return html(resetPasswordPage(undefined, token));
});

pageRoutes.post("/reset-password", loginLimit, async (c) => {
  const form = await c.req.parseBody();
  const token = String(form.token ?? "");
  const password = String(form.password ?? "");
  const confirm = String(form.password_confirm ?? "");
  if (password !== confirm) {
    return html(resetPasswordPage("The two passwords do not match.", token), 400);
  }
  try {
    await resetPassword(c.env.DB, token, password);
  } catch (err) {
    if (err instanceof AuthError) {
      return html(resetPasswordPage(err.message, token), err.status);
    }
    throw err;
  }
  return toastRedirect(c, "/login", "Password updated — you can sign in now");
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

dashboard.get("/event-types/new", async (c) => {
  const user = c.get("user");
  return html(eventTypeCreatePage(user));
});

function parseEventTypeForm(form: Record<string, string | File>): {
  name: string;
  slug: string;
  description: string;
  duration: number;
  bufferMinutes: number;
  seatsTotal: number;
  scheduleMode: "weekly" | "dates";
  datesOnly: number;
  locationType: string;
  locationValue: string;
  dateRows: Array<{ date: string; start: string; end: string }>;
} {
  const isGroup = form.booking_style === "group";
  const scheduleMode = isGroup && form.schedule_mode === "dates" ? "dates" : "weekly";
  const datesOnly = scheduleMode === "dates" ? 1 : 0;
  const dateCount = Math.min(100, Number(form.ed_count) || 0);
  const dateRows: Array<{ date: string; start: string; end: string }> = [];
  if (datesOnly === 1) {
    for (let i = 0; i < dateCount; i++) {
      const date = String(form[`ed_date_${i}`] ?? "").trim();
      const start = String(form[`ed_start_${i}`] ?? "").trim();
      const end = String(form[`ed_end_${i}`] ?? "").trim();
      if (!date && !start && !end) continue;
      dateRows.push({ date, start, end });
    }
  }
  return {
    name: String(form.name ?? "").trim(),
    slug: String(form.slug ?? "")
      .toLowerCase()
      .trim(),
    description: form.description ? String(form.description).trim() : "",
    duration: Number(form.duration_minutes),
    bufferMinutes: Number(form.buffer_minutes),
    seatsTotal: isGroup
      ? (() => {
          const n = Number(form.group_seats);
          return Number.isInteger(n) && n >= 2 && n <= 100 ? n : 2;
        })()
      : 1,
    scheduleMode,
    datesOnly,
    locationType: isLocationType(String(form.location_type ?? ""))
      ? String(form.location_type)
      : "none",
    locationValue:
      normalizeLocationValue(
        isLocationType(String(form.location_type ?? "")) ? String(form.location_type) : "none",
        String(form.location_value ?? ""),
      ) ?? "",
    dateRows,
  };
}

dashboard.post("/event-types", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const {
    name,
    slug,
    description,
    duration,
    bufferMinutes,
    seatsTotal,
    scheduleMode,
    datesOnly,
    locationType,
    locationValue,
    dateRows,
  } = parseEventTypeForm(form as Record<string, string | File>);

  const locationValueToStore = locationType === "none" ? null : locationValue || null;

  const draft: import("../views/dashboard").CreateEventTypeDraft = {
    name,
    slug,
    description,
    durationMinutes: Number.isInteger(duration) ? duration : 30,
    bufferMinutes: Number.isInteger(bufferMinutes) ? bufferMinutes : 0,
    seatsTotal:
      Number.isInteger(seatsTotal) && seatsTotal >= 1 && seatsTotal <= 100 ? seatsTotal : 1,
    scheduleMode,
    dates: dateRows,
    locationType,
    locationValue: locationValueToStore ?? "",
  };

  const invalid =
    !name || name.length > 100
      ? "Name is required and must be 100 characters or fewer."
      : !isEventSlug(slug)
        ? "URL slug must be lowercase letters, digits and dashes."
        : scheduleMode === "weekly" &&
            (!Number.isInteger(duration) || duration < 5 || duration > 480)
          ? "Duration must be between 5 and 480 minutes."
          : scheduleMode === "weekly" &&
              (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120)
            ? "Buffer must be between 0 and 120 minutes."
            : !Number.isInteger(seatsTotal) || seatsTotal < 1 || seatsTotal > 100
              ? "Seats must be between 1 and 100."
              : datesOnly === 1 && dateRows.length === 0
                ? "At least one date is required for a dates-only event."
                : dateRows.some(
                      (r) =>
                        !isEventDateRow({
                          date: r.date,
                          start_time: r.start,
                          end_time: r.end,
                        }),
                    )
                  ? "Each date needs a valid date with a start time before its end time."
                  : locationType !== "none" && !locationValueToStore
                    ? "Location details are required when a location is set."
                    : "";

  if (invalid) {
    return html(eventTypeCreatePage(user, draft, invalid), 400);
  }

  let imageFile: File | undefined;
  if (form.image instanceof File && form.image.size > 0) {
    imageFile = form.image;
  }

  if (imageFile) {
    const limited = await rateLimitIfNeeded(c, LIMITS.eventImage);
    if (limited) return limited;
  }

  let imagePayload: { bytes: Uint8Array; format: import("../lib/image").ImageFormat } | undefined;
  if (imageFile) {
    try {
      imagePayload = await validateEventImage(imageFile);
    } catch (err) {
      const message = err instanceof ImageError ? err.message : "Invalid image.";
      return html(eventTypeCreatePage(user, draft, message), 400);
    }
  }

  const finalLocationValue = locationValueToStore || null;

  try {
    const eventType = await insertEventType(c.env.DB, {
      userId: user.id,
      name,
      slug,
      description: description || null,
      durationMinutes: Number.isInteger(duration) ? duration : 0,
      bufferMinutes: Number.isInteger(bufferMinutes) ? bufferMinutes : 0,
      seatsTotal: Number.isInteger(seatsTotal) ? seatsTotal : 1,
      datesOnly,
      locationType,
      locationValue: finalLocationValue,
      imageKey: null,
      now: nowIso(),
    });

    if (datesOnly === 1) {
      await replaceEventDates(
        c.env.DB,
        eventType.id,
        dateRows.map((r) => ({ date: r.date, startTime: r.start, endTime: r.end })),
        nowIso(),
      );
    }

    if (imagePayload) {
      const key = eventImageKey(user.id, eventType.id, imagePayload.format);
      await c.env.EVENT_IMAGES.put(key, imagePayload.bytes, {
        httpMetadata: { contentType: imagePayload.format },
      });
      await updateEventType(c.env.DB, eventType.id, user.id, {
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description,
        durationMinutes: eventType.duration_minutes,
        bufferMinutes: eventType.buffer_minutes,
        seatsTotal: eventType.seats_total,
        datesOnly: eventType.dates_only,
        locationType: eventType.location_type,
        locationValue: eventType.location_value,
        imageKey: key,
        isActive: eventType.is_active,
        now: nowIso(),
      });
    }

    return toastRedirect(c, "/dashboard/event-types", "Event type created");
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      return html(
        eventTypeCreatePage(user, draft, "You already have an event type with that URL."),
        409,
      );
    }
    throw err;
  }
});

/** Ticket manager: sessions + every guest of one ticketed event, door-check ready. */
dashboard.get("/event-types/:id/tickets", async (c) => {
  const user = c.get("user");
  const eventType = await getEventTypeOwned(c.env.DB, Number(c.req.param("id")), user.id);
  if (!eventType) return notFound();

  const [bookings, attendees] = await Promise.all([
    listConfirmedBookingsForEventType(c.env.DB, eventType.id),
    listAttendeesForEventType(c.env.DB, eventType.id),
  ]);
  const byBooking = new Map<number, typeof attendees>();
  for (const a of attendees) {
    const list = byBooking.get(a.booking_id) ?? [];
    list.push(a);
    byBooking.set(a.booking_id, list);
  }

  // Sessions: listed dates for dates-only types; booked slots otherwise.
  const sessions: TicketManagerSession[] = [];
  if (eventType.dates_only === 1) {
    const dates = await listEventDates(c.env.DB, eventType.id);
    for (const d of dates) {
      const startIso = isoUtc(zonedToUtc(d.date, d.start_time, user.timezone));
      const booking = bookings.find((b) => b.start_at === startIso);
      const guests = booking ? (byBooking.get(booking.id) ?? []) : [];
      sessions.push({
        startAt: startIso,
        registered: guests.filter((g) => g.status === "confirmed").length,
        checkedIn: guests.filter((g) => g.checked_in_at !== null).length,
      });
    }
  } else {
    for (const b of bookings) {
      const guests = byBooking.get(b.id) ?? [];
      sessions.push({
        startAt: b.start_at,
        registered: guests.filter((g) => g.status === "confirmed").length,
        checkedIn: guests.filter((g) => g.checked_in_at !== null).length,
      });
    }
  }

  const guests: TicketManagerGuest[] = attendees.map((a) => ({
    attendeeId: a.id,
    bookingId: a.booking_id,
    name: a.guest_name,
    email: a.guest_email,
    code: a.ticket_code,
    checkedIn: a.checked_in_at !== null,
    cancelled: a.status !== "confirmed",
    sessionStartAt: a.session_start,
  }));

  const data: TicketManagerData = {
    capacity: eventType.seats_total,
    registered: guests.filter((g) => !g.cancelled).length,
    checkedIn: guests.filter((g) => g.checkedIn).length,
    sessions,
    guests,
    publicUrl: `${c.env.APP_URL}/${user.slug}/${eventType.slug}`,
  };

  if (c.req.query("door") === "1") return html(doorModePage(user, eventType, data));
  return html(eventTicketsPage(user, eventType, data, readToast(c)));
});

dashboard.get("/event-types/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const eventType = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!eventType) return notFound();
  const bookings = await countBookingsForEventType(c.env.DB, id);
  const eventDates = await listEventDates(c.env.DB, id);
  const savedLocations =
    eventType.location_type === "google_meet" || eventType.location_type === "zoom"
      ? (await listSavedLocations(c.env.DB, user.id, eventType.location_type)).map(
          (r) => r.location_value,
        )
      : [];
  return html(
    eventTypeEditPage(
      user,
      eventType,
      bookings,
      undefined,
      readToast(c),
      savedLocations,
      eventDates.map((d) => ({ date: d.date, start: d.start_time, end: d.end_time })),
    ),
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
  const currentEventDates = await listEventDates(c.env.DB, id);
  const duration = Number(form.duration_minutes);
  const bufferMinutes = Number(form.buffer_minutes);
  const seatsTotal =
    form.booking_style === "group"
      ? (() => {
          const n = Number(form.group_seats);
          return Number.isInteger(n) && n >= 2 && n <= 100 ? n : 2;
        })()
      : 1;
  const locationType = isLocationType(String(form.location_type ?? ""))
    ? String(form.location_type)
    : "none";
  const savedChoice = String(form.saved_location_value ?? "");
  const useSavedLink =
    (locationType === "google_meet" || locationType === "zoom") &&
    savedChoice &&
    savedChoice !== "__custom__";
  const locationValue = normalizeLocationValue(
    locationType,
    useSavedLink ? savedChoice : String(form.location_value ?? ""),
  );
  const bookings = await countBookingsForEventType(c.env.DB, id);

  // Event dates: schedule is only meaningful for group events. Private events
  // always use the host's weekly availability.
  const isGroup = form.booking_style === "group";
  const scheduleMode = isGroup && form.schedule_mode === "dates" ? "dates" : "weekly";
  const datesOnly = scheduleMode === "dates" ? 1 : 0;
  const dateCount = Math.min(100, Number(form.ed_count) || 0);
  const dateRows: { date: string; start: string; end: string }[] = [];
  if (datesOnly === 1) {
    for (let i = 0; i < dateCount; i++) {
      const date = String(form[`ed_date_${i}`] ?? "").trim();
      const start = String(form[`ed_start_${i}`] ?? "").trim();
      const end = String(form[`ed_end_${i}`] ?? "").trim();
      if (!date && !start && !end) continue;
      dateRows.push({ date, start, end });
    }
  }
  const datesInvalid = dateRows.some(
    (r) => !isEventDateRow({ date: r.date, start_time: r.start, end_time: r.end }),
  );
  const datesMissing = datesOnly === 1 && dateRows.length === 0;

  const removeImage = form.remove_image === "1" || form.remove_image === "on";

  // Validate new image before any DB writes so the event type is never
  // updated with a failed upload.
  let newImagePayload:
    { bytes: Uint8Array; format: import("../lib/image").ImageFormat } | undefined;
  if (form.image instanceof File && form.image.size > 0) {
    const limited = await rateLimitIfNeeded(c, LIMITS.eventImage);
    if (limited) return limited;
    try {
      newImagePayload = await validateEventImage(form.image);
    } catch (err) {
      const message = err instanceof ImageError ? err.message : "Invalid image.";
      return html(eventTypeEditPage(user, current, bookings, message, "", [], dateRows), 400);
    }
  }

  // Re-render with what the host typed, so a validation error never wipes
  // the form. Unparseable values fall back to the stored row.
  const draft: EventTypeRow = {
    ...current,
    name: name || current.name,
    slug: slug || current.slug,
    duration_minutes: Number.isInteger(duration) ? duration : current.duration_minutes,
    buffer_minutes: Number.isInteger(bufferMinutes) ? bufferMinutes : current.buffer_minutes,
    seats_total:
      Number.isInteger(seatsTotal) && seatsTotal >= 1 && seatsTotal <= 100
        ? seatsTotal
        : current.seats_total,
    dates_only: datesOnly,
    description:
      form.description !== undefined ? String(form.description).trim() : current.description,
    location_type: locationType,
    location_value: locationValue ?? "",
    image_key: removeImage ? null : current.image_key,
  };

  const invalid =
    !name || name.length > 100
      ? "Name is required."
      : !isEventSlug(slug)
        ? "URL slug must be lowercase letters, digits and dashes."
        : datesOnly === 0 && (!Number.isInteger(duration) || duration < 5 || duration > 480)
          ? "Duration must be between 5 and 480 minutes."
          : datesOnly === 0 &&
              form.buffer_minutes !== undefined &&
              (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120)
            ? "Buffer must be between 0 and 120 minutes."
            : form.booking_style === "group" &&
                (!Number.isInteger(seatsTotal) || seatsTotal < 2 || seatsTotal > 100)
              ? "Group seats must be between 2 and 100."
              : datesInvalid
                ? "Event dates need a date and a start time before the end time."
                : datesMissing
                  ? "A dates-only event needs at least one date."
                  : locationType !== "none" && !locationValue
                    ? "Location needs an address, link or number."
                    : null;
  if (invalid) {
    return html(eventTypeEditPage(user, draft, bookings, invalid, "", [], dateRows), 400);
  }

  let imageKey = removeImage ? null : current.image_key;

  try {
    if (newImagePayload) {
      const newKey = eventImageKey(user.id, id, newImagePayload.format);
      await c.env.EVENT_IMAGES.put(newKey, newImagePayload.bytes, {
        httpMetadata: { contentType: newImagePayload.format },
      });
      if (current.image_key && current.image_key !== newKey) {
        c.executionCtx.waitUntil(c.env.EVENT_IMAGES.delete(current.image_key));
      }
      imageKey = newKey;
    } else if (removeImage && current.image_key) {
      c.executionCtx.waitUntil(c.env.EVENT_IMAGES.delete(current.image_key));
    }

    await updateEventType(c.env.DB, id, user.id, {
      name,
      slug,
      description: form.description ? String(form.description).trim() : null,
      durationMinutes: datesOnly === 0 && Number.isInteger(duration) ? duration : 0,
      bufferMinutes: Number.isInteger(bufferMinutes) ? bufferMinutes : current.buffer_minutes,
      seatsTotal:
        Number.isInteger(seatsTotal) && seatsTotal >= 1 && seatsTotal <= 100
          ? seatsTotal
          : current.seats_total,
      datesOnly,
      locationType,
      locationValue: locationType === "none" ? null : locationValue,
      imageKey,
      isActive: current.is_active,
      now: nowIso(),
    });

    const currentDatesComparable = currentEventDates
      .map((d) => `${d.date}|${d.start_time}|${d.end_time}`)
      .sort();
    const newDatesComparable = dateRows.map((r) => `${r.date}|${r.start}|${r.end}`).sort();
    const datesChanged =
      current.dates_only !== datesOnly ||
      currentDatesComparable.length !== newDatesComparable.length ||
      !currentDatesComparable.every((v, i) => v === newDatesComparable[i]);

    if (datesChanged) {
      await replaceEventDates(
        c.env.DB,
        id,
        dateRows.map((r) => ({ date: r.date, startTime: r.start, endTime: r.end })),
        nowIso(),
      );
    }
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
    seatsTotal: current.seats_total,
    datesOnly: current.dates_only,
    locationType: current.location_type,
    locationValue: current.location_value,
    imageKey: current.image_key,
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
      seatsTotal: current.seats_total,
      datesOnly: current.dates_only,
      locationType: current.location_type,
      locationValue: current.location_value,
      imageKey: current.image_key,
      isActive: 0,
      now: nowIso(),
    });
    return toastRedirect(c, "/dashboard/event-types", "Event type deactivated");
  } else {
    await deleteEventType(c.env.DB, id, user.id);
    if (current.image_key) {
      c.executionCtx.waitUntil(c.env.EVENT_IMAGES.delete(current.image_key));
    }
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
  let clonedId = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      const row = await insertEventType(c.env.DB, {
        userId: user.id,
        name,
        slug: candidate,
        description: current.description,
        durationMinutes: current.duration_minutes,
        bufferMinutes: current.buffer_minutes,
        seatsTotal: current.seats_total,
        datesOnly: current.dates_only,
        locationType: current.location_type,
        locationValue: current.location_value,
        imageKey: null,
        now,
      });
      clonedId = row.id;
      break;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  // A clone carries the dates too, so a dates-only event copies as a whole.
  if (clonedId) {
    await replaceEventDates(
      c.env.DB,
      clonedId,
      (await listEventDates(c.env.DB, id)).map((d) => ({
        date: d.date,
        startTime: d.start_time,
        endTime: d.end_time,
      })),
      now,
    );
  }
  return toastRedirect(
    c,
    "/dashboard/event-types",
    clonedId ? "Event type cloned" : "Could not clone event type",
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

  // Group slots list their seats (with ticket codes) inline for door checks.
  const attendeesByBooking = new Map<number, BookingAttendeeRow[]>();
  await Promise.all(
    bookings
      .filter((b) => b.seats_total > 1)
      .map(async (b) => {
        attendeesByBooking.set(b.id, await listAttendees(c.env.DB, b.id));
      }),
  );
  return html(bookingsPage(user, bookings, scope, readToast(c), attendeesByBooking));
});

dashboard.post("/bookings/:id/cancel", async (c) => {
  try {
    const booking = await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
    c.executionCtx.waitUntil(queueBookingCancelled(c.env, booking.id));
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;
  }
  return toastRedirect(c, "/dashboard/bookings", "Booking cancelled");
});

/** Door check-in: toggle one seat's redeemed stamp. */
dashboard.post("/bookings/:id/attendees/:attendeeId/check-in", async (c) => {
  const user = c.get("user");
  const bookingId = Number(c.req.param("id"));
  const attendeeId = Number(c.req.param("attendeeId"));
  const booking = await getBookingOwned(c.env.DB, bookingId, user.id);
  if (!booking) return notFound();
  const attendee = await getAttendeeForBooking(c.env.DB, attendeeId, bookingId);
  if (!attendee || attendee.status !== "confirmed") return notFound();

  const next = !attendee.checked_in_at;
  await setAttendeeCheckIn(c.env.DB, attendeeId, bookingId, next, nowIso());
  if ((c.req.header("accept") ?? "").includes("application/json")) {
    return c.json({ checked_in: next });
  }
  const back = c.req.query("back");
  const target = back && back.startsWith("/") ? back : "/dashboard/bookings";
  return toastRedirect(c, target, next ? "Seat checked in" : "Check-in undone");
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
 * Serves event cover images from R2. Same security reasoning as avatars above.
 */
pageRoutes.get("/event-images/:userId/:eventTypeId/:file", async (c) => {
  const key = `event-images/${c.req.param("userId")}/${c.req.param("eventTypeId")}/${c.req.param("file")}`;
  const object = await c.env.EVENT_IMAGES.get(key);
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
    if (eventType.seats_total > 1) {
      // A booking-level token on a group slot would cancel everyone's seat.
      // Guests manage their own place via the link in their confirmation email.
      return html(
        cancelUnavailablePage(
          "This is a group event. Use the link in your confirmation email to cancel your own seat.",
        ),
        409,
      );
    }
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
    if (eventType.seats_total > 1) {
      return html(
        cancelUnavailablePage(
          "Group events cannot be rescheduled. Cancel your seat and book another time instead.",
        ),
        409,
      );
    }
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

  if (eventType.seats_total > 1) {
    // Group events are managed per seat, never with booking-level links.
    const attendeeParam = Number(c.req.query("attendee"));
    let seat:
      | { guestEmail?: string; seatsTaken: number; cancelHref?: string; ticketCode?: string }
      | undefined;
    const seatsTaken = await countConfirmedAttendees(c.env.DB, booking.id);
    if (Number.isInteger(attendeeParam) && attendeeParam > 0) {
      const attendee = await getAttendeeForBooking(c.env.DB, attendeeParam, booking.id);
      if (attendee && attendee.status === "confirmed") {
        seat = {
          guestEmail: attendee.guest_email,
          seatsTaken,
          cancelHref: await attendeeCancelPath(booking.id, attendeeParam, c.env.SESSION_SECRET),
          ticketCode: attendee.ticket_code ?? undefined,
        };
      }
    }
    if (!seat) seat = { seatsTaken };
    return html(confirmationPage(host, eventType, booking, undefined, undefined, seat));
  }

  const href =
    booking.status === "confirmed" ? await cancelPath(booking.id, c.env.SESSION_SECRET) : undefined;
  const reschedule =
    booking.status === "confirmed"
      ? await reschedulePath(booking.id, c.env.SESSION_SECRET)
      : undefined;
  return html(confirmationPage(host, eventType, booking, href, reschedule));
});

/** Seat pages: same flow as guest cancel, scoped to one attendee of a group slot. */
pageRoutes.get(
  "/booking/:id/attendee/:attendeeId/cancel",
  rateLimit(LIMITS.guestCancel),
  async (c) => {
    const token = c.req.query("token") ?? "";
    try {
      const { booking, attendee, eventType, host } = await resolveSeatToken(
        c.env.DB,
        Number(c.req.param("id")),
        Number(c.req.param("attendeeId")),
        token,
        c.env.SESSION_SECRET,
      );
      if (booking.status === "cancelled" || attendee.status !== "confirmed") {
        return html(
          seatCancelledPage(host, eventType, await countConfirmedAttendees(c.env.DB, booking.id)),
        );
      }
      if (Date.parse(booking.end_at) <= Date.now()) {
        return html(cancelUnavailablePage("This meeting has already taken place."), 409);
      }
      return html(cancelSeatConfirmPage(host, eventType, booking, attendee, token));
    } catch (err) {
      if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
      throw err;
    }
  },
);

pageRoutes.post(
  "/booking/:id/attendee/:attendeeId/cancel",
  rateLimit(LIMITS.guestCancel),
  async (c) => {
    const form = await c.req.parseBody();
    const token = String(form.token ?? "");
    try {
      const { attendee } = await cancelAttendeeSeat(
        c.env.DB,
        Number(c.req.param("id")),
        Number(c.req.param("attendeeId")),
        token,
        c.env.SESSION_SECRET,
      );
      // The guest did this themselves; the host is the one who needs telling.
      c.executionCtx.waitUntil(queueAttendeeCancelled(c.env, attendee.booking_id, attendee.id));
      const booking = await getBookingById(c.env.DB, attendee.booking_id);
      const host = booking ? await findUserById(c.env.DB, booking.user_id) : null;
      const eventType = booking ? await getEventTypeById(c.env.DB, booking.event_type_id) : null;
      if (!booking || !host || !eventType) return notFound();
      return html(
        seatCancelledPage(host, eventType, await countConfirmedAttendees(c.env.DB, booking.id)),
      );
    } catch (err) {
      if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
      throw err;
    }
  },
);

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
  // Dates-only types render their sessions server-side: the page already
  // knows the dates, so the ticket view needs zero client fetches.
  const sessions: Array<{
    date: string;
    startAt: string;
    endAt: string;
    seatsLeft: number;
  }> = [];
  if (eventType.dates_only === 1) {
    const today = zonedDateString(new Date(), host.timezone);
    const rows = (await listEventDates(c.env.DB, eventType.id)).filter((d) => d.date >= today);
    if (rows.length > 0) {
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      const busyRows = await listConfirmedBetween(
        c.env.DB,
        host.id,
        isoUtc(zonedToUtc(first.date, first.start_time, host.timezone)),
        isoUtc(zonedToUtc(last.date, last.end_time, host.timezone)),
      );
      for (const d of rows) {
        const startAt = isoUtc(zonedToUtc(d.date, d.start_time, host.timezone));
        const taken = busyRows.find(
          (b) => b.event_type_id === eventType.id && b.start_at === startAt,
        );
        sessions.push({
          date: d.date,
          startAt,
          endAt: isoUtc(zonedToUtc(d.date, d.end_time, host.timezone)),
          seatsLeft: Math.max(0, eventType.seats_total - (taken?.seats_taken ?? 0)),
        });
      }
    }
  }
  return html(bookingPage(host, eventType, undefined, sessions));
});
