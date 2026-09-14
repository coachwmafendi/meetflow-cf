import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insertBookingIfFree, rescheduleBookingIfFree } from "../../src/db/bookings";
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
