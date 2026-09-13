import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

async function seed() {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  return host;
}

const BOOK = "/api/public/wan/consultation/book";

function bookBody(startAt: string) {
  return JSON.stringify({
    start_at: startAt,
    guest_name: "Ahmad",
    guest_email: "ahmad@example.com",
    notes: "Discuss ads",
    timezone: "Asia/Kuala_Lumpur",
  });
}

describe("public booking", () => {
  beforeEach(resetDb);

  it("exposes the public event type", async () => {
    await seed();
    const res = await api("/api/public/wan/consultation");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      host: { slug: "wan", timezone: "Asia/Kuala_Lumpur" },
      eventType: { slug: "consultation", duration_minutes: 30 },
    });
  });

  it("404s for an unknown host or event", async () => {
    await seed();
    expect((await api("/api/public/nobody/consultation")).status).toBe(404);
    expect((await api("/api/public/wan/nope")).status).toBe(404);
  });

  it("lists slots for a date", async () => {
    await seed();
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).toContain("2026-09-21T01:00:00Z");
  });

  it("creates a booking and derives end_at on the server", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    expect(res.status).toBe(201);
    const { booking } = await res.json<{ booking: { end_at: string; status: string } }>();
    expect(booking.end_at).toBe("2026-09-21T01:30:00Z");
    expect(booking.status).toBe("confirmed");
  });

  it("rejects a second booking for the same slot with 409", async () => {
    await seed();
    await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    const second = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: "This time slot is no longer available.",
    });
  });

  it("removes the booked slot from the slot list", async () => {
    await seed();
    await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).not.toContain("2026-09-21T01:00:00Z");
  });

  it("rejects a start time outside availability", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T08:00:00Z") });
    expect(res.status).toBe(422);
  });

  it("rejects a start time off the slot grid", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:07:00Z") });
    expect(res.status).toBe(422);
  });

  it("rejects a booking in the past", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2020-01-06T01:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects an invalid guest email", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T01:00:00Z",
        guest_name: "Ahmad",
        guest_email: "not-an-email",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied end_at", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T01:00:00Z",
        end_at: "2026-09-21T09:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    const { booking } = await res.json<{ booking: { end_at: string } }>();
    expect(booking.end_at).toBe("2026-09-21T01:30:00Z");
  });

  it("survives concurrent submissions for the same slot", async () => {
    await seed();
    const results = await Promise.all([
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
    ]);
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND start_at = '2026-09-21T01:00:00Z'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
