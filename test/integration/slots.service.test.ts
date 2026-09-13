import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getSlotsForDate } from "../../src/services/availability";
import { api, createHost, resetDb } from "../helpers";

async function seed() {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  const created = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const { eventType } = await created.json<{ eventType: { id: number } }>();
  return { host, eventTypeId: eventType.id };
}

const BASE = {
  hostTimezone: "Asia/Kuala_Lumpur",
  durationMinutes: 30,
  nowMs: Date.parse("2026-09-01T00:00:00Z"),
};

describe("getSlotsForDate", () => {
  beforeEach(resetDb);

  it("returns slots inside availability, converted to UTC", async () => {
    const { host, eventTypeId } = await seed();
    // 2026-09-21 is a Monday
    const slots = await getSlotsForDate(env.DB, {
      ...BASE,
      hostId: host.id,
      eventTypeId,
      dateYmd: "2026-09-21",
    });
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-21T01:00:00Z",
      "2026-09-21T01:30:00Z",
      "2026-09-21T02:00:00Z",
      "2026-09-21T02:30:00Z",
    ]);
  });

  it("returns nothing on a day with no rules", async () => {
    const { host, eventTypeId } = await seed();
    // 2026-09-22 is a Tuesday
    const slots = await getSlotsForDate(env.DB, {
      ...BASE,
      hostId: host.id,
      eventTypeId,
      dateYmd: "2026-09-22",
    });
    expect(slots).toEqual([]);
  });

  it("hides past slots", async () => {
    const { host, eventTypeId } = await seed();
    const slots = await getSlotsForDate(env.DB, {
      ...BASE,
      hostId: host.id,
      eventTypeId,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-21T01:45:00Z"),
    });
    expect(slots.map((s) => s.startAt)).toEqual(["2026-09-21T02:00:00Z", "2026-09-21T02:30:00Z"]);
  });

  it("hides slots taken by a confirmed booking", async () => {
    const { host, eventTypeId } = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-21T01:30:00Z','2026-09-21T02:00:00Z','UTC','confirmed',?,?)`,
    )
      .bind(host.id, eventTypeId, now, now)
      .run();

    const slots = await getSlotsForDate(env.DB, {
      ...BASE,
      hostId: host.id,
      eventTypeId,
      dateYmd: "2026-09-21",
    });
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-21T01:00:00Z",
      "2026-09-21T02:00:00Z",
      "2026-09-21T02:30:00Z",
    ]);
  });

  it("ignores cancelled bookings", async () => {
    const { host, eventTypeId } = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-21T01:30:00Z','2026-09-21T02:00:00Z','UTC','cancelled',?,?)`,
    )
      .bind(host.id, eventTypeId, now, now)
      .run();

    const slots = await getSlotsForDate(env.DB, {
      ...BASE,
      hostId: host.id,
      eventTypeId,
      dateYmd: "2026-09-21",
    });
    expect(slots).toHaveLength(4);
  });
});
