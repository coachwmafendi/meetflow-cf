import { Hono } from "hono";
import {
  countBookingsForEventType,
  deleteEventType,
  getEventTypeOwned,
  insertEventType,
  listEventTypes,
  updateEventType,
} from "../db/eventTypes";
import { nowIso } from "../lib/time";
import { ValidationError, isEventSlug, optionalString, requireInt, requireString } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const eventTypeRoutes = new Hono<AppEnv>();

eventTypeRoutes.use("*", requireAuth);

eventTypeRoutes.get("/", async (c) => {
  const eventTypes = await listEventTypes(c.env.DB, c.get("user").id);
  return c.json({ eventTypes });
});

eventTypeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  try {
    const name = requireString(body, "name", { max: 100 });
    const slug = requireString(body, "slug", { max: 60 }).toLowerCase();
    if (!isEventSlug(slug)) {
      throw new ValidationError("slug", "slug must be lowercase letters, digits and dashes");
    }
    const description = optionalString(body, "description");
    const durationMinutes = requireInt(body, "duration_minutes", { min: 5, max: 480 });

    const eventType = await insertEventType(c.env.DB, {
      userId: user.id,
      name,
      slug,
      description,
      durationMinutes,
      now: nowIso(),
    });
    return c.json({ eventType }, 201);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
    if (String(err).includes("UNIQUE")) {
      return c.json({ error: "You already have an event type with that URL" }, 409);
    }
    throw err;
  }
});

eventTypeRoutes.get("/:id", async (c) => {
  const eventType = await getEventTypeOwned(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  if (!eventType) return c.json({ error: "Not found" }, 404);
  return c.json({ eventType });
});

eventTypeRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  try {
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
      isActive:
        body.is_active === undefined
          ? current.is_active
          : requireInt(body, "is_active", { min: 0, max: 1 }),
      now: nowIso(),
    };
    if (!isEventSlug(merged.slug)) throw new ValidationError("slug", "invalid slug");

    const eventType = await updateEventType(c.env.DB, id, user.id, merged);
    if (!eventType) return c.json({ error: "Not found" }, 404);
    return c.json({ eventType });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
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
      isActive: 0,
      now: nowIso(),
    });
    return c.json({ eventType, deactivated: true });
  }

  await deleteEventType(c.env.DB, id, user.id);
  return c.json({ ok: true });
});
