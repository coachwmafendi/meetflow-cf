import { Hono } from "hono";
import {
  countBookingsForEventType,
  deleteEventType,
  getEventTypeOwned,
  insertEventType,
  listEventTypes,
  updateEventType,
} from "../db/eventTypes";
import { listEventDates, replaceEventDates, type EventDateInput } from "../db/eventDates";
import { nowIso } from "../lib/time";
import { listSavedLocations } from "../db/savedLocations";
import {
  ValidationError,
  isEventDateRow,
  isEventSlug,
  isLocationType,
  normalizeLocationValue,
  optionalString,
  requireInt,
  requireString,
  type EventDatePayload,
} from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const eventTypeRoutes = new Hono<AppEnv>();

eventTypeRoutes.use("*", requireAuth);

/** Cap for the dates listed on one event type. */
const MAX_EVENT_DATES = 100;

/** Coerces the JSON `dates` array; shape/ordering are validated by callers. */
function parseEventDates(body: Record<string, unknown>): EventDatePayload[] {
  if (body.dates === undefined) return [];
  if (!Array.isArray(body.dates)) {
    throw new ValidationError("dates", "dates must be an array");
  }
  if (body.dates.length > MAX_EVENT_DATES) {
    throw new ValidationError("dates", `at most ${MAX_EVENT_DATES} dates`);
  }
  return body.dates.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      date: String(row.date ?? ""),
      start_time: String(row.start_time ?? ""),
      end_time: String(row.end_time ?? ""),
    };
  });
}

function toEventDateInput(rows: EventDatePayload[]): EventDateInput[] {
  return rows.map((r) => ({ date: r.date, startTime: r.start_time, endTime: r.end_time }));
}

eventTypeRoutes.get("/", async (c) => {
  const eventTypes = await listEventTypes(c.env.DB, c.get("user").id);
  return c.json({ eventTypes });
});

eventTypeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  try {
    const name = requireString(body, "name", { max: 100 });
    const slug = requireString(body, "slug", { max: 60 }).toLowerCase();
    if (!isEventSlug(slug)) {
      throw new ValidationError("slug", "slug must be lowercase letters, digits and dashes");
    }
    const description = optionalString(body, "description");
    const durationMinutes = requireInt(body, "duration_minutes", { min: 5, max: 480 });
    const bufferMinutes =
      body.buffer_minutes === undefined
        ? 0
        : requireInt(body, "buffer_minutes", { min: 0, max: 120 });
    const seatsTotal =
      body.seats_total === undefined ? 1 : requireInt(body, "seats_total", { min: 1, max: 100 });
    const datesOnly =
      body.dates_only === undefined ? 0 : requireInt(body, "dates_only", { min: 0, max: 1 });
    const dateRows = parseEventDates(body);
    if (dateRows.some((r) => !isEventDateRow(r))) {
      throw new ValidationError("dates", "each date needs YYYY-MM-DD and a start before its end");
    }
    if (datesOnly === 1 && dateRows.length === 0) {
      throw new ValidationError("dates", "at least one date is required for a dates-only event");
    }

    const locationType = String(body.location_type ?? "none");
    if (!isLocationType(locationType)) {
      throw new ValidationError(
        "location_type",
        "location_type must be one of none, google_meet, zoom, in_person, phone",
      );
    }
    const locationValue = normalizeLocationValue(
      locationType,
      optionalString(body, "location_value", 300) ?? "",
    );
    if (locationType !== "none" && !locationValue) {
      throw new ValidationError(
        "location_value",
        "location_value is required when a location is set",
      );
    }

    const eventType = await insertEventType(c.env.DB, {
      userId: user.id,
      name,
      slug,
      description,
      durationMinutes,
      bufferMinutes,
      seatsTotal,
      datesOnly,
      locationType,
      locationValue,
      imageKey: null,
      now: nowIso(),
    });
    await replaceEventDates(c.env.DB, eventType.id, toEventDateInput(dateRows), nowIso());
    return c.json({ eventType }, 201);
  } catch (err) {
    if (err instanceof ValidationError)
      return c.json({ error: err.message, field: err.field }, 400);
    if (String(err).includes("UNIQUE")) {
      return c.json({ error: "You already have an event type with that URL" }, 409);
    }
    throw err;
  }
});

eventTypeRoutes.get("/locations", async (c) => {
  const type = c.req.query("type") ?? "";
  if (!isLocationType(type) || type === "none") return c.json({ locations: [] });
  const rows = await listSavedLocations(c.env.DB, c.get("user").id, type);
  return c.json({ locations: rows.map((r) => r.location_value) });
});

eventTypeRoutes.get("/:id", async (c) => {
  const eventType = await getEventTypeOwned(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  if (!eventType) return c.json({ error: "Not found" }, 404);
  const dates = await listEventDates(c.env.DB, eventType.id);
  return c.json({
    eventType,
    dates: dates.map((d) => ({ date: d.date, start_time: d.start_time, end_time: d.end_time })),
  });
});

eventTypeRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return c.json({ error: "Not found" }, 404);

  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  try {
    let locationType = current.location_type;
    let locationValue = current.location_value;
    if (body.location_type !== undefined || body.location_value !== undefined) {
      locationType =
        body.location_type === undefined ? current.location_type : String(body.location_type);
      if (!isLocationType(locationType)) {
        throw new ValidationError(
          "location_type",
          "location_type must be one of none, google_meet, zoom, in_person, phone",
        );
      }
      const rawValue =
        body.location_value === undefined
          ? (current.location_value ?? "")
          : (optionalString(body, "location_value", 300) ?? "");
      locationValue = normalizeLocationValue(locationType, rawValue);
      if (locationType !== "none" && !locationValue) {
        throw new ValidationError(
          "location_value",
          "location_value is required when a location is set",
        );
      }
    }

    // Dates: both the flag and the set are optional; whatever is sent replaces
    // that part. A dates-only type must keep at least one date.
    let datesOnly = current.dates_only;
    let dateRows: EventDatePayload[] | undefined;
    if (body.dates_only !== undefined || body.dates !== undefined) {
      datesOnly =
        body.dates_only === undefined
          ? current.dates_only
          : requireInt(body, "dates_only", { min: 0, max: 1 });
      dateRows = body.dates === undefined ? undefined : parseEventDates(body);
      const effective = dateRows ?? (await listEventDates(c.env.DB, current.id));
      if (effective.some((r) => !isEventDateRow(r))) {
        throw new ValidationError("dates", "each date needs YYYY-MM-DD and a start before its end");
      }
      if (datesOnly === 1 && effective.length === 0) {
        throw new ValidationError("dates", "at least one date is required for a dates-only event");
      }
    }

    const merged = {
      name: body.name === undefined ? current.name : requireString(body, "name", { max: 100 }),
      slug:
        body.slug === undefined
          ? current.slug
          : requireString(body, "slug", { max: 60 }).toLowerCase(),
      description:
        body.description === undefined ? current.description : optionalString(body, "description"),
      durationMinutes:
        body.duration_minutes === undefined
          ? current.duration_minutes
          : requireInt(body, "duration_minutes", { min: 5, max: 480 }),
      bufferMinutes:
        body.buffer_minutes === undefined
          ? current.buffer_minutes
          : requireInt(body, "buffer_minutes", { min: 0, max: 120 }),
      seatsTotal:
        body.seats_total === undefined
          ? current.seats_total
          : requireInt(body, "seats_total", { min: 1, max: 100 }),
      datesOnly,
      locationType,
      locationValue,
      imageKey: current.image_key,
      isActive:
        body.is_active === undefined
          ? current.is_active
          : requireInt(body, "is_active", { min: 0, max: 1 }),
      now: nowIso(),
    };
    if (!isEventSlug(merged.slug)) throw new ValidationError("slug", "invalid slug");

    const eventType = await updateEventType(c.env.DB, id, user.id, merged);
    if (!eventType) return c.json({ error: "Not found" }, 404);
    if (dateRows) {
      await replaceEventDates(c.env.DB, eventType.id, toEventDateInput(dateRows), nowIso());
    }
    return c.json({ eventType });
  } catch (err) {
    if (err instanceof ValidationError)
      return c.json({ error: err.message, field: err.field }, 400);
    if (String(err).includes("UNIQUE")) {
      return c.json({ error: "You already have an event type with that URL" }, 409);
    }
    throw err;
  }
});

eventTypeRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return c.json({ error: "Not found" }, 404);

  // ERD.md §12: never orphan historical bookings — deactivate instead.
  if ((await countBookingsForEventType(c.env.DB, id)) > 0) {
    const eventType = await updateEventType(c.env.DB, id, user.id, {
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
    return c.json({ eventType, deactivated: true });
  }

  await deleteEventType(c.env.DB, id, user.id);
  return c.json({ ok: true });
});
