import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { signCancelToken } from "../../src/lib/cancelToken";
import { signSession } from "../../src/lib/session";
import { api, createHost, resetDb } from "../helpers";

const SECRET = "test-secret-do-not-use-in-prod";

async function seed(start = "2026-09-21T01:00:00Z") {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
  });
  await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const res = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: start,
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  if (res.status !== 201) throw new Error(`seed failed: ${await res.text()}`);
  const { booking } = await res.json<{ booking: { id: number } }>();
  return { host, bookingId: booking.id };
}

const get = (path: string) => SELF.fetch(`https://example.com${path}`);

const post = (path: string, token: string) =>
  SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

async function statusOf(id: number): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  return row?.status;
}

describe("guest cancellation link", () => {
  beforeEach(resetDb);

  it("shows a confirmation page for a valid link", async () => {
    const { bookingId } = await seed();
    const token = await signCancelToken(bookingId, SECRET);

    const res = await get(`/booking/${bookingId}/cancel?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cancel this appointment?");
    expect(html).toContain("Consultation");
  });

  // The reason GET is inert: mail scanners and prefetchers follow links.
  it("does NOT cancel on GET", async () => {
    const { bookingId } = await seed();
    const token = await signCancelToken(bookingId, SECRET);

    await get(`/booking/${bookingId}/cancel?token=${encodeURIComponent(token)}`);
    expect(await statusOf(bookingId)).toBe("confirmed");
  });

  it("cancels on POST and frees the slot", async () => {
    const { bookingId } = await seed();
    const token = await signCancelToken(bookingId, SECRET);

    const res = await post(`/booking/${bookingId}/cancel`, token);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Appointment cancelled");
    expect(await statusOf(bookingId)).toBe("cancelled");

    const slots = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots: free } = await slots.json<{ slots: Array<{ startAt: string }> }>();
    expect(free.map((s) => s.startAt)).toContain("2026-09-21T01:00:00Z");
  });

  it("rejects a missing, malformed or empty token", async () => {
    const { bookingId } = await seed();
    for (const token of ["", "garbage", "a.b"]) {
      expect((await post(`/booking/${bookingId}/cancel`, token)).status).toBe(404);
    }
    expect(await statusOf(bookingId)).toBe("confirmed");
  });

  it("rejects a token signed with a different secret", async () => {
    const { bookingId } = await seed();
    const forged = await signCancelToken(bookingId, "attacker-secret");

    expect((await post(`/booking/${bookingId}/cancel`, forged)).status).toBe(404);
    expect(await statusOf(bookingId)).toBe("confirmed");
  });

  it("refuses a valid token aimed at a different booking", async () => {
    const { bookingId } = await seed("2026-09-21T01:00:00Z");
    const second = await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T02:00:00Z",
        guest_name: "Siti",
        guest_email: "siti@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    const { booking: other } = await second.json<{ booking: { id: number } }>();

    // Token is genuine, but signed for a different id than the path.
    const token = await signCancelToken(bookingId, SECRET);
    expect((await post(`/booking/${other.id}/cancel`, token)).status).toBe(404);
    expect(await statusOf(other.id)).toBe("confirmed");
  });

  // Domain separation: tokens from other flows must not work here.
  it("refuses a session token used as a cancel token", async () => {
    const { bookingId } = await seed();
    const session = await signSession(bookingId, SECRET);

    expect((await post(`/booking/${bookingId}/cancel`, session)).status).toBe(404);
    expect(await statusOf(bookingId)).toBe("confirmed");
  });

  it("is idempotent — a second cancel still lands on the cancelled page", async () => {
    const { bookingId } = await seed();
    const token = await signCancelToken(bookingId, SECRET);

    await post(`/booking/${bookingId}/cancel`, token);
    const again = await post(`/booking/${bookingId}/cancel`, token);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("Appointment cancelled");
  });

  it("shows the cancelled page when following the link after cancelling", async () => {
    const { bookingId } = await seed();
    const token = await signCancelToken(bookingId, SECRET);
    await post(`/booking/${bookingId}/cancel`, token);

    const res = await get(`/booking/${bookingId}/cancel?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Appointment cancelled");
  });

  it("refuses to cancel a meeting that already happened", async () => {
    const { bookingId } = await seed();
    // Drag the booking into the past behind the service's back.
    await env.DB.prepare("UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?")
      .bind("2020-01-06T01:00:00Z", "2020-01-06T01:30:00Z", bookingId)
      .run();

    const token = await signCancelToken(bookingId, SECRET);
    const res = await post(`/booking/${bookingId}/cancel`, token);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already taken place");
    expect(await statusOf(bookingId)).toBe("confirmed");
  });

  it("offers the link on the confirmation page", async () => {
    const { bookingId } = await seed();
    const res = await get(`/booking/${bookingId}/confirmed`);
    const html = await res.text();
    expect(html).toContain(`/booking/${bookingId}/cancel?token=`);
    expect(html).toContain("Cancel appointment");
  });
});
