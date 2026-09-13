import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

async function seedBooking() {
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
  const res = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: "2026-09-21T01:00:00Z",
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  if (res.status !== 201) throw new Error(`seed booking failed: ${res.status} ${await res.text()}`);
  const { booking } = await res.json<{ booking: { id: number } }>();
  return { host, bookingId: booking.id };
}

describe("host bookings", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/bookings")).status).toBe(401);
  });

  it("lists upcoming bookings with the event name", async () => {
    const { host } = await seedBooking();
    const res = await api("/api/bookings?scope=upcoming", { cookie: host.cookie });
    const { bookings } = await res.json<{
      bookings: Array<{ event_name: string; guest_name: string }>;
    }>();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.event_name).toBe("Consultation");
    expect(bookings[0]!.guest_name).toBe("Ahmad");
  });

  it("cancels without deleting the row", async () => {
    const { host, bookingId } = await seedBooking();
    const res = await api(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      cookie: host.cookie,
    });
    expect(res.status).toBe(200);

    const detail = await api(`/api/bookings/${bookingId}`, { cookie: host.cookie });
    const { booking } = await detail.json<{ booking: { status: string } }>();
    expect(booking.status).toBe("cancelled");
  });

  it("frees the slot after cancellation", async () => {
    const { host, bookingId } = await seedBooking();
    await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: host.cookie });
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).toContain("2026-09-21T01:00:00Z");
  });

  it("blocks another host from cancelling", async () => {
    const { bookingId } = await seedBooking();
    const ali = await createHost("ali");
    const res = await api(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      cookie: ali.cookie,
    });
    expect(res.status).toBe(404);
  });

  it("returns dashboard stats", async () => {
    const { host } = await seedBooking();
    const res = await api("/api/bookings/stats", { cookie: host.cookie });
    expect(await res.json()).toMatchObject({ stats: { total: 1, activeEventTypes: 1 } });
  });
});
