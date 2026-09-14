import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insertBookingIfFree, rescheduleBookingIfFree } from "../../src/db/bookings";
import { rescheduleBooking } from "../../src/services/booking";
import { signCancelToken } from "../../src/lib/cancelToken";
import { api, createHost, resetDb } from "../helpers";

async function seedEventType(cookie: string): Promise<number> {
  const created = await api("/api/event-types", {
    method: "POST",
    cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  expect(created.status).toBe(201);
  const { eventType } = await created.json<{ eventType: { id: number } }>();
  return eventType.id;
}

describe("rescheduleBookingIfFree", () => {
  beforeEach(resetDb);

  const base = {
    guestName: "Ahmad",
    guestEmail: "ahmad@example.com",
    timezone: "UTC",
    notes: "keep me",
    now: "2026-09-01T00:00:00Z",
  };

  it("creates the new booking and cancels the old one", async () => {
    const host = await createHost("wan");
    const eventTypeId = await seedEventType(host.cookie);
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    expect(old).not.toBeNull();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      eventTypeId,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.start_at).toBe("2026-09-21T02:00:00Z");

    const rows = await env.DB.prepare(
      "SELECT id, status, start_at FROM bookings WHERE user_id = ? ORDER BY id",
    )
      .bind(host.id)
      .all<{ id: number; status: string; start_at: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.find((r) => r.id === old!.id)!.status).toBe("cancelled");
    expect(rows.results.find((r) => r.id !== old!.id)!.status).toBe("confirmed");
  });

  it("leaves the old booking alone when the new slot is taken", async () => {
    const host = await createHost("wan");
    const eventTypeId = await seedEventType(host.cookie);
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    const blocker = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(blocker).not.toBeNull();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      eventTypeId,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).toBeNull();

    const oldRow = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(old!.id)
      .first<{ status: string }>();
    expect(oldRow!.status).toBe("confirmed");
  });

  it("rolls the new booking back when the old one was already cancelled", async () => {
    const host = await createHost("wan");
    const eventTypeId = await seedEventType(host.cookie);
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id = ?").bind(old!.id).run();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      eventTypeId,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).toBeNull();

    const confirmed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed'",
    )
      .bind(host.id)
      .first<{ n: number }>();
    expect(confirmed!.n).toBe(0);
  });
});

const SECRET = "test-secret-do-not-use-in-prod";

async function seedBookable() {
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
  const booked = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: "2026-10-05T01:00:00Z",
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      notes: "keep me",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  const { booking } = await booked.json<{ booking: { id: number } }>();
  return { host, eventType, booking };
}

describe("rescheduleBooking", () => {
  beforeEach(resetDb);

  it("moves a booking and copies guest details", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const result = await rescheduleBooking(env.DB, {
      bookingId: booking.id,
      token,
      secret: SECRET,
      newStartAt: "2026-10-05T02:00:00Z",
      guestTimezone: "Asia/Kuala_Lumpur",
      nowMs: Date.parse("2026-10-01T00:00:00Z"),
    });
    expect(result.booking.start_at).toBe("2026-10-05T02:00:00Z");
    expect(result.booking.guest_name).toBe("Ahmad");
    expect(result.booking.notes).toBe("keep me");

    const oldRow = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(booking.id)
      .first<{ status: string }>();
    expect(oldRow!.status).toBe("cancelled");
  });

  it("rejects an invalid token", async () => {
    const { booking } = await seedBookable();
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token: "garbage",
        secret: SECRET,
        newStartAt: "2026-10-05T02:00:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a slot taken by another booking", async () => {
    const { booking } = await seedBookable();
    await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-10-05T02:00:00Z",
        guest_name: "Bob",
        guest_email: "bob@example.com",
        timezone: "UTC",
      }),
    });
    const token = await signCancelToken(booking.id, SECRET);
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token,
        secret: SECRET,
        newStartAt: "2026-10-05T02:00:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to reschedule a past booking", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token,
        secret: SECRET,
        newStartAt: "2026-10-12T02:00:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-30T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("reschedule pages and API", () => {
  beforeEach(resetDb);

  it("renders the reschedule page for a valid link", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const res = await SELF.fetch(
      `https://example.com/booking/${booking.id}/reschedule?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Currently booked");
    expect(html).toContain("Confirm new time");
  });

  it("rejects an invalid token with a friendly page", async () => {
    const { booking } = await seedBookable();
    const res = await SELF.fetch(
      `https://example.com/booking/${booking.id}/reschedule?token=garbage`,
    );
    expect(res.status).toBe(404);
  });

  it("reschedules via POST and returns the new booking", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const res = await SELF.fetch(`https://example.com/booking/${booking.id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        start_at: "2026-10-05T02:00:00Z",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(201);
    const { booking: newBooking } = await res.json<{ booking: { id: number; start_at: string } }>();
    expect(newBooking.start_at).toBe("2026-10-05T02:00:00Z");
    expect(newBooking.id).not.toBe(booking.id);
  });
});
