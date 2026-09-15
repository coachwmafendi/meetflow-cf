import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { signCancelToken, signAttendeeToken } from "../../src/lib/cancelToken";
import { api, createHost, resetDb } from "../helpers";

const SECRET = "test-secret-do-not-use-in-prod";

async function seedGroupEvent(seats = 3) {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  const created = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({
      name: "Workshop",
      slug: "workshop",
      duration_minutes: 30,
      seats_total: seats,
    }),
  });
  expect(created.status).toBe(201);
  return host;
}

async function book(startAt: string, name: string, email: string) {
  const res = await api("/api/public/wan/workshop/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: startAt,
      guest_name: name,
      guest_email: email,
      timezone: "UTC",
    }),
  });
  return { res, body: await res.json<Record<string, unknown>>() };
}

const MONDAY = "2026-10-05T01:00:00Z";

describe("seats", () => {
  beforeEach(resetDb);

  it("lets guests fill a group slot, then refuses with 409", async () => {
    await seedGroupEvent(2);

    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    expect(first.res.status).toBe(201);
    const booking = first.body.booking as { id: number };
    const firstAttendee = first.body.attendee as { id: number };
    expect(firstAttendee.id).toBeGreaterThan(0);

    const second = await book(MONDAY, "Bella", "bella@example.com");
    expect(second.res.status).toBe(201);
    const secondBooking = second.body.booking as { id: number };
    expect(secondBooking.id).toBe(booking.id);

    const third = await book(MONDAY, "Cody", "cody@example.com");
    expect(third.res.status).toBe(409);
    expect(third.body.error).toBe("This event is fully booked.");

    // Another slot of the same event type still books independently.
    const other = await book("2026-10-05T02:00:00Z", "Dana", "dana@example.com");
    expect(other.res.status).toBe(201);
  });

  it("refuses the same email twice and keeps the seat count honest", async () => {
    await seedGroupEvent();
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    expect(first.res.status).toBe(201);
    const dup = await book(MONDAY, "Ahmad Again", "ahmad@example.com");
    expect(dup.res.status).toBe(409);
    expect(dup.body.error).toBe("You have already booked this appointment.");
  });

  it("reports seats_left on slots and keeps joinable slots listed", async () => {
    await seedGroupEvent(3);
    await book(MONDAY, "Ahmad", "ahmad@example.com");
    await book(MONDAY, "Bella", "bella@example.com");

    const res = await api("/api/public/wan/workshop/slots?date=2026-10-05");
    const { slots } = await res.json<{
      slots: Array<{ startAt: string; seatsLeft?: number }>;
    }>();
    const mine = slots.find((s) => s.startAt === MONDAY)!;
    expect(mine.seatsLeft).toBe(1);
    const fresh = slots.find((s) => s.startAt === "2026-10-05T02:00:00Z")!;
    expect(fresh.seatsLeft).toBe(3);
  });

  it("lets a guest cancel their seat and frees the slot when the last seat goes", async () => {
    await seedGroupEvent(2);
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    const attendee = first.body.attendee as { id: number };
    const booking = first.body.booking as { id: number };

    const page = await SELF_fetch(
      `/booking/${booking.id}/attendee/${attendee.id}/cancel?token=${encodeURIComponent(
        await signAttendeeToken(attendee.id, SECRET),
      )}`,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Cancel your seat?");

    const post = await SELF_fetch(`/booking/${booking.id}/attendee/${attendee.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: await signAttendeeToken(attendee.id, SECRET) }).toString(),
    });
    expect(post.status).toBe(200);
    const postHtml = await post.text();
    expect(postHtml).toContain("Seat cancelled");
    expect(postHtml).toContain("the time slot is free again");

    // Slot fully released: a brand-new guest books it as a fresh group slot.
    const again = await book(MONDAY, "Zara", "zara@example.com");
    expect(again.res.status).toBe(201);
  });

  it("rejects a seat token for a different attendee and a garbage token", async () => {
    await seedGroupEvent();
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    const attendee = first.body.attendee as { id: number };
    const booking = first.body.booking as { id: number };

    const wrong = await SELF_fetch(
      `/booking/${booking.id}/attendee/${attendee.id + 100}/cancel?token=${encodeURIComponent(
        await signAttendeeToken(attendee.id + 100, SECRET),
      )}`,
    );
    expect(wrong.status).toBe(404);

    const garbage = await SELF_fetch(
      `/booking/${booking.id}/attendee/${attendee.id}/cancel?token=nope`,
    );
    expect(garbage.status).toBe(404);
  });

  it("refuses booking-level cancel and reschedule links on group slots", async () => {
    await seedGroupEvent();
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    const booking = first.body.booking as { id: number };
    const cancelToken = await signCancelToken(booking.id, SECRET);

    const cancel = await SELF_fetch(`/booking/${booking.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: cancelToken }).toString(),
    });
    expect(cancel.status).toBe(409);
    expect(await cancel.text()).toContain("group event");

    const reschedule = await SELF_fetch(
      `/booking/${booking.id}/reschedule?token=${encodeURIComponent(cancelToken)}`,
    );
    expect(reschedule.status).toBe(409);
    expect(await reschedule.text()).toContain("Group events cannot be rescheduled");
  });

  it("shows the seat state on the confirmation page", async () => {
    await seedGroupEvent(3);
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    const booking = first.body.booking as { id: number };
    const attendee = first.body.attendee as { id: number };
    await book(MONDAY, "Bella", "bella@example.com");

    const res = await SELF_fetch(`/booking/${booking.id}/confirmed?attendee=${attendee.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("2 of 3 taken");
    expect(html).toContain("Cancel my seat");
    expect(html).not.toContain("Reschedule");

    // Without the attendee hint the page shows details but no seat links.
    const plain = await SELF_fetch(`/booking/${booking.id}/confirmed`);
    const plainHtml = await plain.text();
    expect(plainHtml).toContain("2 of 3 taken");
    expect(plainHtml).not.toContain("Cancel my seat");
  });

  it("cascades a host cancel to every seat", async () => {
    const host = await seedGroupEvent();
    const first = await book(MONDAY, "Ahmad", "ahmad@example.com");
    await book(MONDAY, "Bella", "bella@example.com");
    const bookingId = (first.body.booking as { id: number }).id;

    const cancel = await api(`/dashboard/bookings/${bookingId}/cancel`, {
      method: "POST",
      cookie: host.cookie,
    });
    // api() follows the toast redirect to the list page.
    expect(cancel.status).toBe(200);

    const rows = await env.DB.prepare(
      `SELECT status FROM booking_attendees WHERE booking_id = ? ORDER BY id`,
    )
      .bind(bookingId)
      .all<{ status: string }>();
    expect(rows.results.map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("keeps private events working exactly as before (no attendee rows)", async () => {
    const host = await createHost("wan");
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
    const res = await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: MONDAY,
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "UTC",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<Record<string, unknown>>();
    expect(body.attendee).toBeUndefined();

    const seats = await env.DB.prepare("SELECT COUNT(*) AS n FROM booking_attendees").first<{
      n: number;
    }>();
    expect(seats!.n).toBe(0);

    const clash = await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: MONDAY,
        guest_name: "Bella",
        guest_email: "bella@example.com",
        timezone: "UTC",
      }),
    });
    expect(clash.status).toBe(409);
  });
});

function SELF_fetch(path: string, init?: RequestInit) {
  return SELF.fetch(`https://example.com${path}`, init);
}
