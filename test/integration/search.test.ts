import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insertBookingIfFree } from "../../src/db/bookings";
import { api, createHost, resetDb } from "../helpers";

/** Host + Monday 09:00-17:00 availability + a 30-min event type, via the public API. */
async function seedHost(slug: string, seatsTotal = 1) {
  const host = await createHost(slug);
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
  });
  const res = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({
      name: "Consultation",
      slug: "consultation",
      duration_minutes: 30,
      seats_total: seatsTotal,
    }),
  });
  const { eventType } = await res.json<{ eventType: { id: number } }>();
  return { host, eventType };
}

async function book(host: { slug: string }, startAt: string, name: string, email: string) {
  return SELF.fetch(`https://example.com/api/public/${host.slug}/consultation/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      start_at: startAt,
      guest_name: name,
      guest_email: email,
      timezone: "Asia/Kuala_Lumpur",
      notes: "Discuss the quarterly budget",
    }),
  });
}

/** Inserts a booking row directly (avoids depending on booking-flow mechanics). */
function insertBooking(hostId: number, eventTypeId: number, startAt: string) {
  return insertBookingIfFree(env.DB, {
    userId: hostId,
    eventTypeId,
    guestName: "Direct Guest",
    guestEmail: "direct@example.com",
    startAt,
    endAt: startAt.replace("T05:00:00Z", "T05:30:00Z"),
    timezone: "Asia/Kuala_Lumpur",
    notes: "Discuss the quarterly budget",
    bufferMinutes: 0,
    now: "2026-09-15T00:00:00Z",
  });
}

describe("GET /api/search", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/search?q=ahmad")).status).toBe(401);
  });

  it("finds a booking by guest name, email and notes", async () => {
    const { host } = await seedHost("wan");
    await book(host, "2026-09-21T05:00:00Z", "Ahmad Zulkifli", "ahmad@example.com");

    for (const q of ["ahmad", "AHMAD@example.com", "quarterly budget"]) {
      const res = await api(`/api/search?q=${encodeURIComponent(q)}`, { cookie: host.cookie });
      expect(res.status).toBe(200);
      const body = await res.json<{ bookings: Array<{ guest_name: string }> }>();
      expect(body.bookings).toHaveLength(1);
      expect(body.bookings[0]!.guest_name).toBe("Ahmad Zulkifli");
    }
  });

  it("never returns another host's data", async () => {
    const wan = await seedHost("wan");
    await book(wan.host, "2026-09-21T05:00:00Z", "Ahmad Zulkifli", "ahmad@example.com");
    const ali = await seedHost("ali");
    const res = await api("/api/search?q=ahmad", { cookie: ali.host.cookie });
    const body = await res.json<{ bookings: unknown[] }>();
    expect(body.bookings).toEqual([]);

    const resConsult = await api("/api/search?q=consult", { cookie: ali.host.cookie });
    const bodyConsult = await resConsult.json<{ eventTypes: Array<{ slug: string }> }>();
    expect(bodyConsult.eventTypes).toHaveLength(1);
    expect(bodyConsult.eventTypes[0]!.slug).toBe("consultation");
  });

  it("finds an event type by name and slug", async () => {
    const { host } = await seedHost("wan");
    for (const q of ["consult", "consultation"]) {
      const res = await api(`/api/search?q=${encodeURIComponent(q)}`, { cookie: host.cookie });
      const body = await res.json<{ eventTypes: Array<{ slug: string }> }>();
      expect(body.eventTypes[0]!.slug).toBe("consultation");
    }
  });

  it("finds an attendee by name or email", async () => {
    const { host, eventType } = await seedHost("wan");
    const booking = await insertBooking(host.id, eventType.id, "2026-09-21T05:00:00Z");
    if (!booking) throw new Error("booking insert failed");
    const now = "2026-09-15T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO booking_attendees
         (booking_id, guest_name, guest_email, notes, timezone, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'Asia/Kuala_Lumpur', 'confirmed', ?, ?)`,
    )
      .bind(booking.id, "Sara Lim", "sara@example.com", now, now)
      .run();

    const res = await api("/api/search?q=sara", { cookie: host.cookie });
    const body = await res.json<{
      attendees: Array<{ guest_email: string; booking_id: number }>;
    }>();
    expect(body.attendees).toHaveLength(1);
    expect(body.attendees[0]!.guest_email).toBe("sara@example.com");
    expect(body.attendees[0]!.booking_id).toBe(booking.id);
  });

  it("returns 3 recent bookings on an empty query and no match groups", async () => {
    const { host, eventType } = await seedHost("wan");
    await insertBooking(host.id, eventType.id, "2026-09-21T05:00:00Z");
    await insertBooking(host.id, eventType.id, "2026-09-28T05:00:00Z");
    await insertBooking(host.id, eventType.id, "2026-10-05T05:00:00Z");
    await insertBooking(host.id, eventType.id, "2026-10-12T05:00:00Z");

    const res = await api("/api/search", { cookie: host.cookie });
    const body = await res.json<{
      bookings: unknown[];
      eventTypes: unknown[];
      attendees: unknown[];
    }>();
    expect(body.bookings).toHaveLength(3);
    expect(body.eventTypes).toEqual([]);
    expect(body.attendees).toEqual([]);
  });

  it("treats LIKE wildcards literally", async () => {
    const { host } = await seedHost("wan");
    await book(host, "2026-09-21T05:00:00Z", "Ahmad Zulkifli", "ahmad@example.com");

    const res = await api("/api/search?q=%25ahmad%25", { cookie: host.cookie });
    const body = await res.json<{ bookings: unknown[] }>();
    expect(body.bookings).toEqual([]);
  });

  it("rejects an over-100-char query", async () => {
    const { host } = await seedHost("wan");
    const res = await api(`/api/search?q=${"x".repeat(101)}`, { cookie: host.cookie });
    expect(res.status).toBe(400);
  });
});
