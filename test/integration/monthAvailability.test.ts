import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getMonthFreeDays } from "../../src/services/availability";
import { api, createHost, resetDb } from "../helpers";

const BASE = {
  hostTimezone: "Asia/Kuala_Lumpur",
  durationMinutes: 30,
  nowMs: Date.parse("2026-09-01T00:00:00Z"),
};

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

describe("getMonthFreeDays", () => {
  beforeEach(resetDb);

  it("returns every Monday in a month with Monday rules", async () => {
    const { host, eventTypeId } = await seed();
    // Mondays in September 2026 (Sep 1 is a Tuesday): 7, 14, 21, 28.
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("returns nothing for a month fully in the past", async () => {
    const { host, eventTypeId } = await seed();
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 8,
    });
    expect(days).toEqual([]);
  });

  it("drops past days of the current month", async () => {
    const { host, eventTypeId } = await seed();
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
      nowMs: Date.parse("2026-09-10T00:00:00Z"),
    });
    expect(days).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("excludes a day fully taken by a confirmed booking", async () => {
    const { host, eventTypeId } = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-14T01:00:00Z','2026-09-14T03:00:00Z','UTC','confirmed',?,?)`,
    )
      .bind(host.id, eventTypeId, now, now)
      .run();

    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual(["2026-09-07", "2026-09-21", "2026-09-28"]);
  });

  it("returns nothing when the host has no rules", async () => {
    const host = await createHost("norrules", "Asia/Kuala_Lumpur");
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual([]);
  });

  it("handles leap February (29 days)", async () => {
    const host = await createHost("leap", "Asia/Kuala_Lumpur");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({
        rules: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          day_of_week: dow,
          start_time: "09:00",
          end_time: "09:30",
        })),
      }),
    });
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2028,
      month: 2,
    });
    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2028-02-01");
    expect(days[28]).toBe("2028-02-29");
  });
});

describe("GET /api/public/:username/:eventSlug/month", () => {
  beforeEach(resetDb);

  it("returns bookable days for the requested month", async () => {
    await seed();
    // Mondays in March 2027 (Mar 1 2027 is a Monday): 1, 8, 15, 22, 29.
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=2027&month=3",
    );
    expect(res.status).toBe(200);
    const { days } = await res.json<{ days: string[] }>();
    expect(days).toEqual(["2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22", "2027-03-29"]);
  });

  it("rejects an out-of-range month", async () => {
    await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=2026&month=13",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric year", async () => {
    await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=abc&month=9",
    );
    expect(res.status).toBe(400);
  });

  it("404s for an unknown event", async () => {
    await seed();
    const res = await SELF.fetch("https://example.com/api/public/wan/nope/month?year=2026&month=9");
    expect(res.status).toBe(404);
  });
});
